"""Weather grid for all of Estonia: the ERA5-Land 0.1 deg grid (about 11 x 6 km).

Each 10 m forest cell belongs to the nearest grid node. Node id = round(lat * 10) * 1000 +
round(lon * 10), e.g. 58.2 N 27.1 E -> 582271. Precipitation and ET0 come from ERA5 (0.25 deg,
Open-Meteo has none for era5_land), so each node also has the nearest ERA5 node.

  ruudud     rewrite valjund/eesti/ilmaruut_<leht>.tif and list the nodes with forest:
             andmed/eesti/ilm/punktid.json  {node: {lat, lon, era5, lahtreid}}
  lae        resumable download (Open-Meteo, development only): ERA5-Land and ERA5 from --algus,
             only the missing days are fetched again; then the forecast for every node.
             Paced under the free limit (10 000 calls a day): the first full download takes ~2 days,
             later runs only add the latest days. Stops at the daily limit, run again tomorrow.
  kliima     climate normals of every ERA5 node (rain, ET0, temperature, May-September of
             parameetrid.KLIIMA_AASTAD; resumable, ~18 000 calls = ~2 days of the free limit) and
             the mapping into the test sheet's climate: andmed/eesti/ilm/kliima.json
  viljumine  fruiting model for every node x water regime class -> valjund/eesti/viljumine.csv.gz

Run: uv run python -I skriptid/ilmavork.py [ruudud|lae|kliima|viljumine|koik] [--algus 2026-01-01]
"""
import argparse
import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ala import BASE  # noqa: E402

ILM = BASE / "andmed" / "eesti" / "ilm"
PUNKTID = ILM / "punktid.json"
VALJUND = BASE / "valjund" / "eesti"
SAMM = 10                        # node lookup on a 10 x 10 cell (100 m) grid, then repeated
PROGNOOS_PAEVI = 10
TUNNI_KAAL = 4500                # API call weight per hour we allow ourselves (limit 5000)
MINUTI_KAAL = 500                # ... and per minute (limit 600)

_to_wgs = Transformer.from_crs(3301, 4326, always_xy=True)


def soolm(lat, lon):
    return np.rint(np.asarray(lat) * 10).astype(np.int64) * 1000 + np.rint(np.asarray(lon) * 10).astype(np.int64)


def soolme_koht(node):
    return (node // 1000) / 10, (node % 1000) / 10


def era5_soolm(lat, lon):
    """Nearest ERA5 0.25 deg node as a file name part, e.g. '5825_2700'."""
    return f"{round(lat * 4) * 25}_{round(lon * 4) * 25}"


def ilmaruut(transform, height, width):
    """Weather node id of every cell of a north-up grid (uint32)."""
    ch, cw = -(-height // SAMM), -(-width // SAMM)
    x = transform.c + (np.arange(cw) + 0.5) * SAMM * transform.a
    y = transform.f + (np.arange(ch) + 0.5) * SAMM * transform.e
    lon, lat = _to_wgs.transform(*np.meshgrid(x, y))
    coarse = soolm(lat, lon).astype(np.uint32)
    return np.repeat(np.repeat(coarse, SAMM, 0), SAMM, 1)[:height, :width]


# ---------- ruudud ----------

def ruudud():
    counts = {}
    files = sorted(VALJUND.glob("sobivus_*.tif"))
    for i, f in enumerate(files, 1):
        leht = f.stem.split("_")[1]
        with rasterio.open(f) as d:
            forest = ~np.isnan(d.read(1))
            prof = d.profile
        ids = np.where(forest, ilmaruut(prof["transform"], prof["height"], prof["width"]), 0).astype(np.uint32)
        with rasterio.open(VALJUND / f"ilmaruut_{leht}.tif", "w",
                           **dict(prof, dtype="uint32", nodata=0, compress="deflate")) as d:
            d.write(ids, 1)
        u, n = np.unique(ids[forest], return_counts=True)
        for k, c in zip(u.tolist(), n.tolist()):
            counts[k] = counts.get(k, 0) + c
        if i % 50 == 0:
            print(f"  {i}/{len(files)} lehte")
    out = {}
    for k in sorted(counts):
        lat, lon = soolme_koht(k)
        out[str(k)] = {"lat": lat, "lon": lon, "era5": era5_soolm(lat, lon), "lahtreid": counts[k]}
    ILM.mkdir(parents=True, exist_ok=True)
    PUNKTID.write_text(json.dumps(out, indent=0), encoding="utf-8")
    print(f"Ilmapunkte metsaga {len(out)}, ERA5 punkte {len({v['era5'] for v in out.values()})}")


# ---------- lae ----------

class Paevalimiit(Exception):
    pass


_kasutatud = []   # (time, weight) of requests in the last hour


def _oota(kaal):
    while True:
        now = time.time()
        _kasutatud[:] = [(t, w) for t, w in _kasutatud if now - t < 3600]
        minute = sum(w for t, w in _kasutatud if now - t < 60)
        if not _kasutatud or (sum(w for _, w in _kasutatud) + kaal <= TUNNI_KAAL and minute + kaal <= MINUTI_KAAL):
            break
        time.sleep(5)
    _kasutatud.append((time.time(), kaal))


def _paring(url, params, kaal):
    from lae_testala import session
    for k in range(8):
        _oota(kaal)
        try:
            r = session.get(url, params=params, timeout=300)
        except Exception as e:  # noqa: BLE001
            print(f"  viga ({e.__class__.__name__}), proovin uuesti")
            time.sleep(30 * (k + 1))
            continue
        if r.status_code == 429:
            reason = r.json().get("reason", "")
            if "Daily" in reason:
                raise Paevalimiit(reason)
            print(f"  limiit: {reason} - ootan")
            time.sleep(600 if "Hourly" in reason else 65)
            continue
        r.raise_for_status()
        out = r.json()
        return out if isinstance(out, list) else [out]
    raise RuntimeError(f"päring ebaõnnestus: {url}")


def _kaal(n_loc, n_var, n_days):
    # Open-Meteo counts > 10 variables or > 14 days of one location as several calls
    return n_loc * max(1.0, n_var / 10) * max(1.0, n_days / 14)


def _viimane(path, key):
    """Data of a stored file without the trailing missing days, and its last date."""
    if not path.exists():
        return None, None
    d = json.loads(path.read_text("utf-8"))["daily"]
    ok = [i for i, v in enumerate(d[key]) if v is not None]
    if not ok:
        return None, None
    n = ok[-1] + 1
    d = {k: v[:n] for k, v in d.items()}
    return d, date.fromisoformat(d["time"][-1])


def lae_arhiiv(nodes, model, variables, key, algus, lopp, batch=10):
    """nodes: {file name part: (lat, lon)}. Appends only the days after the last stored one."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    prefix = model.replace("_", "")
    todo = {}
    for name in nodes:
        path = ILM / f"{prefix}_{name}.json"
        _, last = _viimane(path, key)
        if last is None and path.exists():
            continue   # sea in this model: an answer without any values
        start = algus if last is None else last + timedelta(days=1)
        if start <= lopp:
            todo.setdefault(start, []).append(name)
    total = sum(len(v) for v in todo.values())
    print(f"  {model}: {len(nodes)} punkti, laadida {total}")
    done = 0
    for start, names in sorted(todo.items()):
        days = (lopp - start).days + 1
        for i in range(0, len(names), batch):
            part = names[i:i + batch]
            res = _paring(url, {
                "latitude": ",".join(str(nodes[n][0]) for n in part),
                "longitude": ",".join(str(nodes[n][1]) for n in part),
                "start_date": start.isoformat(), "end_date": lopp.isoformat(),
                "daily": variables, "models": model, "timezone": "Europe/Tallinn",
            }, _kaal(len(part), variables.count(",") + 1, days))
            for name, r in zip(part, res):
                path = ILM / f"{prefix}_{name}.json"
                old, _ = _viimane(path, key)
                if old:
                    r["daily"] = {k: old[k] + r["daily"][k] for k in r["daily"]}
                path.write_text(json.dumps(r), encoding="utf-8")
            done += len(part)
            print(f"  {model} {start}: {done}/{total}")


def lae_prognoos(nodes, batch=50):
    from lae_testala import FORECAST
    url = "https://api.open-meteo.com/v1/forecast"
    names = list(nodes)
    days = 14 + PROGNOOS_PAEVI + 1
    for i in range(0, len(names), batch):
        part = names[i:i + batch]
        res = _paring(f"{url}?{FORECAST}", {
            "latitude": ",".join(str(nodes[n][0]) for n in part),
            "longitude": ",".join(str(nodes[n][1]) for n in part),
            "past_days": 14, "forecast_days": PROGNOOS_PAEVI + 1, "timezone": "Europe/Tallinn",
        }, _kaal(len(part), 6, days))
        for name, r in zip(part, res):
            (ILM / f"prognoos_{name}.json").write_text(json.dumps(r), encoding="utf-8")
        print(f"  prognoos: {min(i + batch, len(names))}/{len(names)}")


def lae(algus):
    from lae_testala import DAILY_ERA5, DAILY_LAND
    pts = json.loads(PUNKTID.read_text("utf-8"))
    land = {k: (v["lat"], v["lon"]) for k, v in pts.items()}
    era5 = {}
    for v in pts.values():
        a, b = v["era5"].split("_")
        era5[v["era5"]] = (int(a) / 100, int(b) / 100)
    lopp = date.today() - timedelta(days=1)
    try:
        lae_arhiiv(era5, "era5", DAILY_ERA5, "precipitation_sum", algus, lopp)
        lae_arhiiv(land, "era5_land", DAILY_LAND, "temperature_2m_mean", algus, lopp)
        lae_prognoos(land)
    except Paevalimiit as e:
        print(f"\nPäevane limiit täis ({e}). Käivita homme uuesti, laadimine jätkub samast kohast.")
        sys.exit(1)


# ---------- kliima ----------

KLIIMA = ILM / "kliima"
KLIIMA_JSON = ILM / "kliima.json"
KLIIMA_VARS = "precipitation_sum,et0_fao_evapotranspiration,temperature_2m_mean"


def lae_kliima(nodes, batch=10):
    """ERA5 summers per node and year, newest year first (normals usable before all years are in)."""
    import parameetrid as P
    url = "https://archive-api.open-meteo.com/v1/archive"
    m0, m1 = P.KLIIMA_KUUD
    KLIIMA.mkdir(parents=True, exist_ok=True)
    for year in range(P.KLIIMA_AASTAD[1], P.KLIIMA_AASTAD[0] - 1, -1):
        start, end = date(year, m0, 1), date(year, m1 + 1, 1) - timedelta(days=1)
        todo = [n for n in nodes if not (KLIIMA / f"era5_{n}_{year}.json").exists()]
        for i in range(0, len(todo), batch):
            part = todo[i:i + batch]
            res = _paring(url, {
                "latitude": ",".join(str(nodes[n][0]) for n in part),
                "longitude": ",".join(str(nodes[n][1]) for n in part),
                "start_date": start.isoformat(), "end_date": end.isoformat(),
                "daily": KLIIMA_VARS, "models": "era5", "timezone": "Europe/Tallinn",
            }, _kaal(len(part), 3, (end - start).days + 1))
            for name, r in zip(part, res):
                (KLIIMA / f"era5_{name}_{year}.json").write_text(json.dumps(r["daily"]), encoding="utf-8")
        print(f"  kliima {year}: valmis ({len(todo)} laaditud)")


def kliima_normid():
    """Per ERA5 node: rain and ET0 factors (reference / local May-September normal, from the summers
    downloaded so far); per ERA5-Land node: the monthly temperature shift (reference - local)."""
    import pandas as pd
    import parameetrid as P
    norm = {}
    for f in sorted(KLIIMA.glob("era5_*_*.json")):
        _, a, b, year = f.stem.split("_")
        d = pd.DataFrame(json.loads(f.read_text("utf-8")))
        d["kuu"] = pd.to_datetime(d["time"]).dt.month
        norm.setdefault(f"{a}_{b}", []).append(d)
    years = {k: len(v) for k, v in norm.items()}
    ref = P.KLIIMA_VIIDE
    if ref not in norm:
        raise SystemExit(f"Viitesõlme {ref} kliimat pole veel laaditud")
    stats = {}
    for k, parts in norm.items():
        d = pd.concat(parts)
        n = len(parts)
        stats[k] = {"P": d["precipitation_sum"].sum() / n, "E": d["et0_fao_evapotranspiration"].sum() / n,
                    "T": d.groupby("kuu")["temperature_2m_mean"].mean()}
    lo, hi = P.KLIIMA_PIIRID
    r = stats[ref]
    out = {"viide": ref, "aastaid": years, "solmed": {}}
    for k, s in stats.items():
        out["solmed"][k] = {
            "kP": round(float(np.clip(r["P"] / s["P"], lo, hi)), 3),
            "kE": round(float(np.clip(r["E"] / s["E"], lo, hi)), 3),
            "dT": {int(m): round(float(r["T"][m] - s["T"][m]), 2) for m in s["T"].index},
            "P": round(float(s["P"])), "E": round(float(s["E"])),
        }
    # temperature: from the same data the model runs on (ERA5-Land 0.1 deg, the 2026 summer), as the
    # coastal ERA5 cells are partly sea and too maritime for the land temperature. Differences between
    # places are steady from year to year, so one summer is enough for them.
    pts = json.loads(PUNKTID.read_text("utf-8"))
    sea = asendused(pts)
    def kuud(node):
        d = json.loads((ILM / f"era5land_{sea.get(node, node)}.json").read_text("utf-8"))["daily"]
        t = pd.Series(d["temperature_2m_mean"], index=pd.to_datetime(d["time"]), dtype=float)
        t = t[t.index.month.isin(range(P.KLIIMA_KUUD[0], P.KLIIMA_KUUD[1] + 1))]
        return t.groupby(t.index.month).mean()
    ref_t = kuud(P.KLIIMA_VIIDE_MAA)
    out["maa_viide"] = P.KLIIMA_VIIDE_MAA
    out["maa"] = {}
    for node in pts:
        if (ILM / f"era5land_{sea.get(node, node)}.json").exists():
            t = kuud(node)
            out["maa"][node] = {int(m): round(float(ref_t[m] - t[m]), 2) for m in t.index}
    for v in out["solmed"].values():
        v.pop("dT")
    KLIIMA_JSON.write_text(json.dumps(out, indent=1), encoding="utf-8")
    kp = [v["kP"] for v in out["solmed"].values()]
    print(f"kliima.json: {len(stats)} sõlme, aastaid {min(years.values())}-{max(years.values())}, "
          f"vihma tegur {min(kp):.2f}-{max(kp):.2f}")


def kliima():
    pts = json.loads(PUNKTID.read_text("utf-8"))
    era5 = {}
    for v in pts.values():
        a, b = v["era5"].split("_")
        era5[v["era5"]] = (int(a) / 100, int(b) / 100)
    import parameetrid as P
    # the reference node first, so normals can be computed as soon as possible
    order = dict(sorted(era5.items(), key=lambda kv: kv[0] != P.KLIIMA_VIIDE))
    try:
        lae_kliima(order)
    except Paevalimiit as e:
        print(f"\nPäevane limiit täis ({e}). Käivita homme uuesti, laadimine jätkub samast kohast.")
    kliima_normid()


# ---------- viljumine ----------

def asendused(pts):
    """Nodes that are sea in ERA5-Land (coast, small islands) -> nearest node with data."""
    sea, land = [], []
    for node in pts:
        path = ILM / f"era5land_{node}.json"
        if path.exists():
            (land if _viimane(path, "temperature_2m_mean")[1] else sea).append(node)
    out = {}
    for node in sea:
        lat, lon = pts[node]["lat"], pts[node]["lon"]
        k = np.cos(np.radians(lat))
        out[node] = min(land, key=lambda n: (pts[n]["lat"] - lat) ** 2 + ((pts[n]["lon"] - lon) * k) ** 2)
    return out


def viljumine():
    import pandas as pd
    import parameetrid as P
    from viljumine import kohanda, load_weather, simulate

    pts = json.loads(PUNKTID.read_text("utf-8"))
    klim = json.loads(KLIIMA_JSON.read_text("utf-8")) if KLIIMA_JSON.exists() else {"solmed": {}, "maa": {}}
    print(f"  kohalik kliima: vihm {len(klim['solmed'])} ERA5 sõlme ({klim.get('aastaid') and min(klim['aastaid'].values())}+ aastat), "
          f"temperatuur {len(klim['maa'])} sõlme")
    sea = asendused(pts)
    if sea:
        print(f"  ERA5-Landis meri, ajalugu lähimast punktist: {sea}")
    rows, puudu = [], []
    t0 = time.time()
    for i, (node, v) in enumerate(pts.items(), 1):
        if not (ILM / f"era5land_{node}.json").exists() or not (ILM / f"era5_{v['era5']}.json").exists():
            puudu.append(node)
            continue
        wx = load_weather(node, ILM, era5_point=v["era5"], land_point=sea.get(node))
        if v["era5"] in klim["solmed"] and node in klim["maa"]:
            wx = kohanda(wx, {**klim["solmed"][v["era5"]], "dT": klim["maa"][node]})
        for regime in P.VEEREZIIM:
            d = simulate(wx, regime)
            d["allikas"] = wx["allikas"]
            d.insert(0, "klass", regime)
            d.insert(0, "punkt", int(node))
            rows.append(d)
        if i % 100 == 0:
            print(f"  {i}/{len(pts)} punkti, {time.time() - t0:.0f} s")
    out = pd.concat(rows).rename_axis("kuupaev").reset_index()
    VALJUND.mkdir(parents=True, exist_ok=True)
    out.to_csv(VALJUND / "viljumine.csv.gz", float_format="%.4f", index=False)
    print(f"valjund/eesti/viljumine.csv.gz: {len(out)} rida, punkte {out['punkt'].nunique()}"
          f"{f', ilmata {len(puudu)}' if puudu else ''}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mis", nargs="?", default="koik", choices=["ruudud", "lae", "kliima", "viljumine", "koik"])
    ap.add_argument("--algus", default="2026-01-01", help="first day of the weather history")
    a = ap.parse_args()
    if a.mis in ("ruudud", "koik"):
        print("Ilmaruudud")
        ruudud()
    if a.mis in ("lae", "koik"):
        print("Ilm (Open-Meteo, ainult arenduseks)")
        lae(date.fromisoformat(a.algus))
    if a.mis == "kliima":
        print("Kliimanormid (Open-Meteo ERA5)")
        kliima()
    if a.mis in ("viljumine", "koik"):
        print("Viljumine")
        viljumine()


if __name__ == "__main__":
    main()
