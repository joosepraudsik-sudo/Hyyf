"""Export test area data for the web page (leht/andmed/testala_5458.js).

The display value is linear in the fruiting index, so per 50 m cell we store, for each water
regime class c, the neighbourhood mean of suitability * [class == c]. The browser computes
  value = sum_c index(point, c, day) * S_c
which equals soojuskaart.py exactly, without one map per day. For the click explanation each
cell also carries its own (unsmoothed) factor scores, raw inputs and the dominant stand and soil.

Everything goes into one script file (window.SIIL = {...}) so the page also works when
index.html is opened straight from disk (file:// blocks fetch):
  meta       grid size, corners (lon, lat), band names, class names
  rakud      base64 uint8, bands x rows x cols (see meta.kihid)
  eraldised  stand table referenced by the "eraldis" bands: koosseis, vanus, kasvukoht
  mullad     soil table referenced by the "muld" bands: short description
  viljumine  dates, points, base64 uint8 [day][point][class][indeks, niiskus, w, hooaeg, temperatuur]

Run: uv run python -I skriptid/eksport.py
"""
import base64
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402
from kasvukoht import forest_share, stand_table  # noqa: E402
from soojuskaart import BLOCK, MIN_FOREST, RES, nearest_point, neighbourhood  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
AREA = BASE / "andmed" / "testala_5458"
GRID = AREA / "ruudustik"
OUT = BASE / "valjund"
WEB = BASE / "leht" / "andmed"
CLASSES = sorted(P.VEEREZIIM)
MONTHS = (6, 11)   # June..November (the season ends in October, forecast may reach into November)
TIME_COLS = ["indeks", "niiskus", "w", "hooaeg", "temperatuur"]

LOIMIS_NIMI = {"l": "liiv", "pl": "peenliiv", "sl": "saviliiv", "plsl": "saviliiv", "tsl": "saviliiv",
               "ls": "liivsavi", "tls": "liivsavi", "s": "savi", "t": "turvas"}


def read(path, band=1):
    with rasterio.open(path) as d:
        return d.read(band), d


def blocks(a):
    h, w = (s // BLOCK for s in a.shape)
    return a[:h * BLOCK, :w * BLOCK].reshape(h, BLOCK, w, BLOCK).transpose(0, 2, 1, 3).reshape(h, w, -1)


def block_mean(a, forest):
    b, f = blocks(np.where(forest, a, 0.0)), blocks(forest)
    with np.errstate(invalid="ignore"):
        return b.sum(-1) / f.sum(-1)


def block_mode(a, forest):
    """Most common non-zero value among forest cells of each block (0 if none)."""
    b, f = blocks(np.where(forest, a, 0)), blocks(forest)
    out = np.zeros(b.shape[:2], dtype=np.int64)
    for i, j in zip(*np.nonzero(f.any(-1))):
        v, n = np.unique(b[i, j][b[i, j] > 0], return_counts=True)
        if len(v):
            out[i, j] = v[np.argmax(n)]
    return out


def soil_text(sif, loimis):
    sif = sif if isinstance(sif, str) else ""
    parts = []
    if sif[:1] in ("M", "S", "R"):
        parts.append("turvasmuld")
    elif sif[:1] == "G":
        parts.append("gleimuld (märg)")
    elif "G" in sif[1:] or "g" in sif:
        parts.append("gleistunud (niiske)")
    elif sif[:1] == "K":
        parts.append("lubjarikas" if not sif.startswith("KI") else "leetjas")
    elif sif[:1] in ("L", "E"):
        parts.append("leetunud (happeline)")
    if isinstance(loimis, str) and loimis:
        words = []
        for part in loimis.split("/")[:2]:
            m = re.search(r"(plsl|tsl|tls|pl|sl|ls|l|s|t)", re.sub(r"^((v°|k°|kr|kb|ck|dk|pk|lu|v|r|k|p|d|\+)\d?)+", "", part))
            if m and LOIMIS_NIMI[m.group(1)] not in words:
                words.append(LOIMIS_NIMI[m.group(1)])
        if words:
            parts.append("/".join(words))
        if re.search(r"(^|/)(v(?!°)|k(?!°)|r|pk|p|lu|\+)", loimis):
            parts.append("paekivine")
    return f"{sif} · " + ", ".join(parts) if parts else sif


PUUD = {"MA": "mänd", "KU": "kuusk", "KS": "kask", "TA": "tamm", "LH": "lehis", "HB": "haab",
        "NU": "nulg", "TS": "ebatsuuga", "SD": "seedermänd", "PN": "pärn", "SA": "saar", "VA": "vaher",
        "JA": "jalakas", "LV": "hall lepp", "LM": "sanglepp", "RE": "remmelgas", "PP": "pappel"}


def guide(site_names):
    """Scoring rules for the page's guide, taken straight from parameetrid.py."""
    pts = lambda table: [[x, round(y * 100)] for x, y in table]
    return {
        "piiravad": P.PIIRAVAD,
        "kaalud": P.KAALUD,
        "puuliik": sorted(([PUUD.get(k, k), round(v * 100)] for k, v in P.PUULIIK.items()), key=lambda r: -r[1]),
        "puuliik_muu": round(P.PUULIIK_MUU * 100),
        "segu_boonus": round(P.SEGU_BOONUS * 100),
        "segu_min": P.SEGU_MIN,
        "teine_rinne": P.TEINE_RINNE_KAAL,
        "kasvukoht": sorted(([site_names.get(k, k), round(v[0] * 100)] for k, v in P.KASVUKOHT.items()),
                            key=lambda r: -r[1]),
        "vanus": pts(P.VANUS),
        "valgus": [[round(x * 100), round(y * 100)] for x, y in P.VALGUS],
        "tihedus": [[round(x * 100), round(y * 100)] for x, y in P.TIHEDUS],
        "twi": pts(P.TWI),
        "sidusus": [[round(x * 100), round(y * 100)] for x, y in P.SIDUSUS],
        "sidusus_raadius": P.SIDUSUS_RAADIUS,
        "okotoon": pts(P.OKOTOON),
        "loimis": [[LOIMIS_NIMI[k], round(v * 100)] for k, v in P.LOIMIS.items() if k in ("l", "sl", "ls", "s", "t")],
        "muld_niiskus": [["turvasmuld", round(P.MULD_TURVAS * 100)], ["gleimuld", round(P.MULD_GLEI * 100)],
                         ["tugevalt gleistunud", round(P.MULD_GLEISTUNUD_G * 100)],
                         ["gleistunud", round(P.MULD_GLEISTUNUD * 100)], ["nõrgalt gleistunud", round(P.MULD_NORK_GLEI * 100)],
                         ["hästi dreenitud", 100]],
        "muld_astmed": P.MULD_ASTMED,
        "muld_hape": [["leetunud (happeline)", round(P.MULD_HAPE["L"] * 100)], ["leetjas", round(P.MULD_HAPE["KI"] * 100)],
                      ["lubjarikas", round(P.MULD_HAPE["K"] * 100)]],
        "aeg": {
            "algus_temp": pts(P.ALGUS_TEMP), "mulla_temp": pts(P.MULLA_TEMP), "mulla_temp_aken": P.MULLA_TEMP_AKEN,
            "hooaeg_kp": pts(P.HOOAEG_KP), "kp_alus": P.KRAADIPAEV_ALUS,
            "niiskus": pts(P.NIISKUS), "viivitus_kp": P.VIIVITUS_KP, "viivitus_alus": P.VIIVITUS_ALUS,
            "viivitus_max": P.VIIVITUS_MAX, "elu": round((1 - P.ELU_PAEV) * 100), "elu_jahe": round((1 - P.ELU_JAHE) * 100),
            "jahe": P.JAHE_PIIR, "kulm": P.KULM_PIIR,
            "reziim": {k: {"nimi": v["nimi"], "kp": v["kp"]} for k, v in P.VEEREZIIM.items()},
        },
    }


def to_u8(a, scale=255):
    return np.round(np.clip(np.nan_to_num(a), 0, 1) * scale).astype(np.uint8)


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    suit, d = read(OUT / "sobivus_5458.tif")
    t = d.transform
    regime, _ = read(OUT / "veereziim_5458.tif")
    forest = ~np.isnan(suit)
    with rasterio.open(OUT / "tegurid_5458.tif") as d:
        factors = {d.descriptions[i]: d.read(i + 1) for i in range(d.count)}
    cover, _ = read(GRID / "katvus.tif")
    twi, _ = read(GRID / "twi.tif")
    stand_id, _ = read(GRID / "eraldis.tif")
    soil_idx, _ = read(GRID / "muld.tif")

    # neighbourhood suitability per water regime class (what the map shows)
    s_c = [neighbourhood(np.where(forest & (regime == c), suit, 0), forest) for c in CLASSES]
    shown = np.isfinite(s_c[0])
    h, w = shown.shape
    names, point_idx = nearest_point(t, suit.shape)
    centre = point_idx[BLOCK // 2::BLOCK, BLOCK // 2::BLOCK][:h, :w]

    # per-cell explanation layers (unsmoothed block means / modes)
    stand_mode = block_mode(stand_id, forest)
    soil_mode = block_mode(soil_idx, forest)
    stand_ids = np.unique(stand_mode[stand_mode > 0])
    soil_rows = np.unique(soil_mode[soil_mode > 0])
    stand_ref = np.searchsorted(stand_ids, stand_mode) + 1
    soil_ref = np.searchsorted(soil_rows, soil_mode) + 1
    stand_ref[stand_mode == 0] = 0
    soil_ref[soil_mode == 0] = 0

    layers = {f"S{c}": to_u8(s) for c, s in zip(CLASSES, s_c)}
    layers["ilmapunkt"] = np.where(shown, centre, 255).astype(np.uint8)
    for k, a in factors.items():
        layers[f"t_{k}"] = to_u8(block_mean(a, forest))
    layers["katvus"] = to_u8(block_mean(cover, forest), 100)
    layers["twi"] = np.round(np.clip(np.nan_to_num(block_mean(twi, forest)), 0, 25.5) * 10).astype(np.uint8)
    layers["metsaosa"] = to_u8(block_mean(forest_share(cover, RES), forest), 100)
    mire_m, _ = read(OUT / "soo_kaugus_5458.tif")
    layers["soo_10m"] = np.round(np.clip(np.nan_to_num(block_mean(mire_m, forest)) / 10, 0, 255)).astype(np.uint8)
    layers["klass"] = block_mode(regime.astype(np.int64), forest).astype(np.uint8)
    for name, ref in [("eraldis", stand_ref), ("muld", soil_ref)]:
        layers[f"{name}_lo"] = (ref & 255).astype(np.uint8)
        layers[f"{name}_hi"] = (ref >> 8).astype(np.uint8)
    data = np.stack(list(layers.values()))

    # stand and soil tables
    st = stand_table().loc[stand_ids]
    kl = json.loads((AREA / "metsaregister" / "kl_kasvukoht.json").read_text("utf-8"))
    site_names = {f["properties"]["kood"]: f["properties"]["kirjeldus"] for f in kl["features"]}
    stands = [{"koosseis": r.koosseis, "vanus": None if pd.isna(r.vanus_a) else int(r.vanus_a),
               "kasvukoht": site_names.get(r.kasvukoht_kood, r.kasvukoht_kood)} for r in st.itertuples()]
    soil = pd.read_csv(GRID / "muld.csv", encoding="utf-8").set_index("rida").loc[soil_rows]
    soils = [soil_text(r.Sif1, r.Lihtloimis) for r in soil.itertuples()]

    to_ll = Transformer.from_crs("EPSG:3301", "EPSG:4326", always_xy=True)
    x0, y1 = t.c, t.f
    x1, y0 = x0 + w * BLOCK * RES, y1 - h * BLOCK * RES
    corners = [to_ll.transform(x, y) for x, y in [(x0, y1), (x1, y1), (x1, y0), (x0, y0)]]
    meta = {
        "nimi": "Testala 5458 (Põlvamaa)",
        "laius": w, "korgus": h, "ruut_m": BLOCK * RES,
        "nurgad": [[round(lon, 6), round(lat, 6)] for lon, lat in corners],  # NW, NE, SE, SW
        "kihid": list(layers),
        "klassid": {c: P.VEEREZIIM[c]["nimi"] for c in CLASSES},
        "piiravad": list(P.PIIRAVAD),
        "kaalud": P.KAALUD,
        "ilmapunktid": names,
        "min_mets": MIN_FOREST,
    }

    fr = pd.read_csv(OUT / "viljumine_5458.csv", parse_dates=["kuupaev"])
    fr = fr[fr["kuupaev"].dt.month.between(*MONTHS)]
    cube = fr.pivot_table(index="kuupaev", columns=["punkt", "klass"], values=TIME_COLS)
    days = cube.index
    arr = np.stack([cube[col].reindex(columns=pd.MultiIndex.from_product([names, CLASSES])).to_numpy()
                    .reshape(len(days), len(names), len(CLASSES)) for col in TIME_COLS], axis=-1)
    source = fr.groupby("kuupaev")["allikas"].first().reindex(days)
    today = pd.Timestamp.today().normalize()
    fruiting = {
        "allikas": "ERA5 / ERA5-Land kuni ~5 päeva tagasi, edasi mudelianalüüs ja prognoos (Open-Meteo), arendusandmed",
        "tana": f"{today:%Y-%m-%d}",
        "paeva_allikas": source.fillna("era5").tolist(),
        "kuupaevad": [f"{x:%Y-%m-%d}" for x in days],
        "ilmapunktid": names,
        "klassid": CLASSES,
        "valjad": TIME_COLS,
        "andmed": base64.b64encode(to_u8(arr).tobytes()).decode("ascii"),
    }

    payload = {"meta": meta, "rakud": base64.b64encode(data.tobytes()).decode("ascii"),
               "eraldised": stands, "mullad": soils, "viljumine": fruiting,
               "juhend": guide(site_names)}
    for old in WEB.glob("*_5458.*"):
        old.unlink()
    (WEB / "testala_5458.js").write_text(
        "window.SIIL = " + json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + ";\n", "utf-8")

    for f in sorted(WEB.iterdir()):
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")
    print(f"kihte {len(layers)}, 50 m ruute metsaga {shown.sum()}, eraldisi {len(stands)}, "
          f"mullapolügoone {len(soils)}, kuupäevi {len(days)}")
    print("näide:", stands[0], "|", soils[0])


if __name__ == "__main__":
    main()
