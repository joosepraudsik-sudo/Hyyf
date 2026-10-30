"""Check the model against the user's own finds (validation only - never used to set parameters).

Input: andmed/leiud/leiud.csv (id, lat, lon, kuupaev, tulemus 0..3, kirjeldus); kept out of git.
For every find: download a 3 x 3 km window around it, run the same site and fruiting models,
and compute the map value on that date (100 m neighbourhood, as on the page) at the point and
the best value within 200 m (GPS point vs. the walked area).
Output: valjund/kontroll/kontroll_leiud.csv and a table on screen.

Run: uv run python -I skriptid/kontroll.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer
from scipy.signal import fftconvolve

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kasvukoht  # noqa: E402
import parameetrid as P  # noqa: E402
import ruudustik  # noqa: E402
from ala import BASE, punkti_ala  # noqa: E402
from lae_testala import lae_ilm, lae_korgus, lae_metsaregister  # noqa: E402
from viljumine import load_weather, simulate  # noqa: E402

LEIUD = BASE / "andmed" / "leiud" / "leiud.csv"
ILM = BASE / "andmed" / "kontroll" / "ilm"
OUT = BASE / "valjund" / "kontroll"
RES = 10
YMBRUS_M = 100       # neighbourhood shown on the map
OTSING_M = 200       # best value within this radius of the point
# map classes, same rule as the page: forest step + time step (parameetrid.KLASS_KOHT / KLASS_AEG)
KLASSID = ["tippkoht", "suurepärane", "väga hea", "hea", "võimalik"]
TULEMUS = {0: "ei leidnud", 1: "üksikud", 2: "mõned", 3: "väga hea saak"}


def disk(r_m):
    r = int(r_m / RES)
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    return (xx ** 2 + yy ** 2 <= r ** 2).astype(float)


def step(x, bounds):
    return next((i for i, b in enumerate(bounds) if x >= b), -1)


def class_index(koht, aeg):
    k, a = step(koht, P.KLASS_KOHT), step(aeg, P.KLASS_AEG)
    return k + a if k >= 0 and a >= 0 and k + a < len(KLASSID) else 9


def check(row, to3301):
    x, y = to3301.transform(row.lon, row.lat)
    ala = punkti_ala(f"k{row.id}", x, y)
    print(f"\n=== Leid {row.id}: {row.kuupaev} {row.kirjeldus} ({ala.x0}-{ala.x1}, {ala.y0}-{ala.y1})")
    lae_korgus(ala)
    lae_metsaregister(ala)
    ruudustik.build(ala)
    kasvukoht.run(ala)

    out = ala.valjund
    with rasterio.open(out / f"sobivus_{ala.nimi}.tif") as d:
        suit = d.read(1)
    with rasterio.open(out / f"veereziim_{ala.nimi}.tif") as d:
        regime = d.read(1)
    with rasterio.open(out / f"tegurid_{ala.nimi}.tif") as d:
        factors = {d.descriptions[i]: d.read(i + 1) for i in range(d.count)}
    forest = ~np.isnan(suit)

    # fruiting index on the date for every water regime class at this point's weather
    wx = load_weather(ala.nimi, ILM)
    day = pd.Timestamp(row.kuupaev)
    index, aeg = {}, {}
    for c in P.VEEREZIIM:
        sim = simulate(wx, c)
        index[c] = float(sim.loc[day, "indeks"])
        aeg[c] = sim.loc[day, ["niiskus", "hooaeg", "temperatuur"]].to_dict()

    # map value field: neighbourhood mean over forest cells of suitability x index(class)
    k = disk(YMBRUS_M)
    num = sum(fftconvolve(np.where(forest & (regime == c), suit, 0) * index[c], k, mode="same")
              for c in P.VEEREZIIM)
    den = fftconvolve(forest.astype(float), k, mode="same")
    koht_num = fftconvolve(np.where(forest, suit, 0), k, mode="same")
    with np.errstate(invalid="ignore", divide="ignore"):
        value = np.where(den > 0.5, num / den, np.nan)
        koht_n = np.where(den > 0.5, koht_num / den, np.nan)

    with np.errstate(invalid="ignore", divide="ignore"):
        aeg_n = np.where(koht_n > 0, value / koht_n, np.nan)
    cls = np.vectorize(class_index)(np.nan_to_num(koht_n), np.nan_to_num(aeg_n))
    cls = np.where(np.isfinite(value), cls, 99)

    r, col = int((ala.y1 - y) // RES), int((x - ala.x0) // RES)
    rr = int(OTSING_M / RES)
    ring = disk(OTSING_M) > 0
    win = np.where(ring, value[r - rr:r + rr + 1, col - rr:col + rr + 1], np.nan)
    best = np.nanmax(win) if np.isfinite(win).any() else np.nan
    best_cls = int(np.where(ring, cls[r - rr:r + rr + 1, col - rr:col + rr + 1], 99).min())
    in_forest = bool(forest[r, col])
    c_here = int(regime[r, col]) if in_forest else int(pd.Series(regime[r - 10:r + 11, col - 10:col + 11].ravel())
                                                        .replace(0, np.nan).mode().iloc[0]) if (regime[r - 10:r + 11, col - 10:col + 11] > 0).any() else 0
    st = kasvukoht.stand_table(ala)
    with rasterio.open(ala.grid / "eraldis.tif") as d:
        sid = int(d.read(1)[r, col])
    stand = st.loc[sid] if sid in st.index else None

    res = {
        "id": row.id, "kuupaev": row.kuupaev, "tulemus": row.tulemus, "kirjeldus": row.kirjeldus,
        "metsaregistris": in_forest,
        "koosseis": stand["koosseis"] if stand is not None else "",
        "vanus": stand["vanus_a"] if stand is not None else np.nan,
        "kasvukoht": stand["kasvukoht_kood"] if stand is not None else "",
        "veereziim": P.VEEREZIIM[c_here]["nimi"] if c_here else "",
        "koht_punkt": float(suit[r, col]) if in_forest else np.nan,
        "koht_ymbrus": float(koht_n[r, col]),
        "aeg": index.get(c_here, np.nan),
        "hinne_punkt": float(value[r, col]),
        "hinne_parim_200m": float(best),
    }
    for name, a in factors.items():
        res["t_" + name] = float(a[r, col]) if in_forest else np.nan
    if c_here:
        for kk, vv in aeg[c_here].items():
            res["a_" + kk] = float(vv)
    nimi = lambda c: KLASSID[c] if c < len(KLASSID) else ("–" if c < 99 else "metsa pole")
    res["klass_punkt"] = nimi(int(cls[r, col]))
    res["klass_200m"] = nimi(best_cls)
    return res


def main():
    leiud = pd.read_csv(LEIUD, encoding="utf-8")
    to3301 = Transformer.from_crs("EPSG:4326", "EPSG:3301", always_xy=True)
    lopp = (date.today() - timedelta(days=1)).isoformat()
    lae_ilm(ILM, {f"k{r.id}": (r.lat, r.lon) for r in leiud.itertuples()}, algus="2026-01-01", lopp=lopp)

    rows = [check(r, to3301) for r in leiud.itertuples()]
    df = pd.DataFrame(rows)
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_csv(OUT / "kontroll_leiud.csv", index=False, encoding="utf-8")

    pd.set_option("display.width", 200)
    show = df[["id", "kuupaev", "kirjeldus", "metsaregistris", "koosseis", "vanus", "kasvukoht",
               "veereziim", "koht_ymbrus", "aeg", "hinne_punkt", "klass_punkt", "hinne_parim_200m", "klass_200m"]]
    print("\n" + show.round(2).to_string(index=False))
    print(f"\nvaljund/kontroll/kontroll_leiud.csv")


if __name__ == "__main__":
    main()
