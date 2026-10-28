"""Site suitability model v0 for harilik kukeseen on the 10 m grid.

Reads the grid layers from ruudustik.py and forest register attributes, writes to valjund/:
  sobivus_5458.tif     suitability 0..1 (NaN outside forest register stands)
  veereziim_5458.tif   water regime class 1 dry, 2 fresh, 3 moist, 4 wet, 5 drained peat (0 = none)
  ilmaruut_5458.tif    weather cell id (placeholder 2.5 km L-EST97 grid: row * 1000 + col)
  tegurid_5458.tif     one band per factor score, for inspection

Run: uv run python -I skriptid/kasvukoht.py
"""
import json
import re
import sys
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
AREA = BASE / "andmed" / "testala_5458"
GRID = AREA / "ruudustik"
OUT = BASE / "valjund"
YEAR = 2026


def interp(x, table):
    xs, ys = zip(*table)
    return np.interp(x, xs, ys)


def read(name):
    with rasterio.open(GRID / name) as d:
        return d.read(1), d.profile


# ---------- forest stands ----------

def stand_table():
    st = gpd.read_file(AREA / "metsaregister" / "eraldis.geojson", ignore_geometry=True)
    el = pd.DataFrame(json.loads((AREA / "metsaregister" / "eraldis_element.json").read_text("utf-8")))
    el["score"] = el["puuliik_kood"].map(P.PUULIIK).fillna(P.PUULIIK_MUU)

    def layer(rinne):
        e = el[el["rinne_kood"] == rinne]
        g = e.assign(w=e["osakaal"] * e["score"]).groupby("eraldis_id")
        return g["w"].sum() / g["osakaal"].sum()

    s1, s2 = layer("1"), layer("2")
    e1 = el[el["rinne_kood"] == "1"]
    n_hosts = e1[(e1["score"] >= 0.6) & (e1["osakaal"] >= 20)].groupby("eraldis_id").size()
    age1 = e1[e1["enamus"] == True].groupby("eraldis_id")["vanus"].max()  # noqa: E712

    st = st.set_index("id")
    host = s1.reindex(st.index)
    has2 = s2.reindex(st.index).notna()
    host[has2] = (host[has2] + P.TEINE_RINNE_KAAL * s2.reindex(st.index)[has2]) / (1 + P.TEINE_RINNE_KAAL)
    host = host + np.where(n_hosts.reindex(st.index).fillna(0) >= 2, P.SEGU_BOONUS, 0)
    fallback = st["peapuuliik_kood"].map(P.PUULIIK)
    host = host.fillna(fallback).fillna(0.10).clip(0, 1)  # no species at all: likely clearcut

    age = age1.reindex(st.index).fillna(st["keskm_vanus"])
    inv_year = pd.to_datetime(st["invent_kp"], errors="coerce").dt.year
    age = age + (YEAR - inv_year).fillna(0).clip(lower=0)
    age_score = pd.Series(interp(age.fillna(-1), P.VANUS), index=st.index).where(age.notna(), 0.5)

    site = st["kasvukoht_kood"].map(lambda k: P.KASVUKOHT.get(k, P.KASVUKOHT_PUUDUB))
    return pd.DataFrame({
        "puuliik": host,
        "vanus": age_score,
        "kasvukoht": site.map(lambda t: t[0]),
        "reziim": site.map(lambda t: t[1]).astype(np.uint8),
        "kuivendatud": st["kuivendatud"].fillna(False).astype(bool),
    })


# ---------- soil ----------

COARSE = re.compile(r"^((v°|k°|kr|kb|ck|dk|pk|lu|v|r|k|p|d|\+)\d?)+")
CARBONATE = re.compile(r"^(v(?!°)|k(?!°)|r|pk|p|lu|\+)")
FINE = re.compile(r"^(plsl|tsl|tls|pl|sl|ls|l|s|t)")


def texture_score(formula):
    if not isinstance(formula, str) or not formula:
        return P.LOIMIS_MUU, False
    parts = formula.split("/")[:2]
    scores, carb = [], False
    for part in parts:
        carb |= bool(CARBONATE.match(part))
        m = FINE.match(COARSE.sub("", part))
        scores.append(P.LOIMIS.get(m.group(1), P.LOIMIS_MUU) if m else 0.7)
    s = scores[0] if len(scores) == 1 else 0.7 * scores[0] + 0.3 * scores[1]
    return s, carb


def soil_name_scores(sif):
    if not isinstance(sif, str) or not sif:
        return 0.8, 0.9
    if sif[0] in "MSRT":
        wet = P.MULD_TURVAS
    elif sif[0] == "G":
        wet = P.MULD_GLEI
    elif "G" in sif[1:]:
        wet = P.MULD_GLEISTUNUD_G
    elif "(g)" in sif:
        wet = P.MULD_NORK_GLEI
    elif "g" in sif:
        wet = P.MULD_GLEISTUNUD
    else:
        wet = 1.0
    acid = P.MULD_HAPE["KI"] if sif.startswith("KI") else P.MULD_HAPE.get(sif[0], 0.9)
    return wet, acid


def soil_table():
    m = pd.read_csv(GRID / "muld.csv", encoding="utf-8")
    wet = np.zeros(len(m))
    acid = np.zeros(len(m))
    wsum = np.zeros(len(m))
    for i in range(1, 5):
        share = m[f"Osa{i}"].fillna(0).to_numpy(float)
        if i == 1:
            share = np.where(share == 0, 100, share)
        sc = np.array([soil_name_scores(s) for s in m[f"Sif{i}"]])
        use = share > 0
        wet[use] += share[use] * sc[use, 0]
        acid[use] += share[use] * sc[use, 1]
        wsum[use] += share[use]
    wet, acid = wet / wsum, acid / wsum
    tex = np.array([texture_score(f) for f in m["Lihtloimis"]], dtype=object)
    tex_s = tex[:, 0].astype(float)
    acid = np.where(tex[:, 1].astype(bool), acid * P.KARBONAATNE_KORES, acid)
    score = wet ** 0.45 * tex_s ** 0.35 * acid ** 0.20
    # index 0 = no soil polygon -> neutral
    return np.concatenate([[0.7], score]), np.concatenate([[1.0], wet])


# ---------- model ----------

def main():
    OUT.mkdir(exist_ok=True)
    stand_id, profile = read("eraldis.tif")
    soil_idx, _ = read("muld.tif")
    twi, _ = read("twi.tif")
    cover, _ = read("katvus.tif")

    st = stand_table()
    ids = st.index.to_numpy()
    order = np.argsort(ids)
    pos = np.searchsorted(ids[order], stand_id)
    pos = np.clip(pos, 0, len(ids) - 1)
    forest = (stand_id > 0) & (ids[order][pos] == stand_id)
    row = order[pos]

    def stand_raster(col):
        return np.where(forest, st[col].to_numpy()[row], np.nan)

    soil_score, soil_wet = soil_table()
    f = {
        "puuliik": stand_raster("puuliik"),
        "vanus": stand_raster("vanus"),
        "valgus": interp(cover, P.VALGUS),
        "kasvukoht": stand_raster("kasvukoht"),
        "muld": soil_score[soil_idx],
        "mikroniiskus": interp(twi, P.TWI),
        "tihedus": interp(cover, P.TIHEDUS),
    }
    limit = np.prod([np.clip(f[k], 0, 1) ** e for k, e in P.PIIRAVAD.items()], axis=0)
    log_s = sum(w * np.log(np.clip(f[k], 0.01, 1)) for k, w in P.KAALUD.items())
    mean = np.exp(log_s / sum(P.KAALUD.values()))
    suit = np.where(forest, limit * mean, np.nan).astype(np.float32)

    regime = np.where(forest, st["reziim"].to_numpy()[row], 0).astype(np.int16)
    mineral = (regime >= 1) & (regime <= 3)
    regime = np.where(mineral & (twi > P.TWI_MARJEM), regime + 1, regime)
    regime = np.where(mineral & (regime >= 2) & (twi < P.TWI_KUIVEM), regime - 1, regime)
    drained = np.where(forest, st["kuivendatud"].to_numpy()[row], False)
    regime = np.where(drained & ((regime == 3) | (regime == 4)), regime - 1, regime).astype(np.uint8)

    t = profile["transform"]
    cols = (t.c + (np.arange(profile["width"]) + 0.5) * t.a - 360000) // 2500
    rows = (t.f + (np.arange(profile["height"]) + 0.5) * t.e - 6370000) // 2500
    weather = (rows[:, None] * 1000 + cols[None, :]).astype(np.uint32)

    base = dict(profile, count=1, compress="deflate")
    with rasterio.open(OUT / "sobivus_5458.tif", "w", **dict(base, dtype="float32", nodata=np.nan)) as d:
        d.write(suit, 1)
    with rasterio.open(OUT / "veereziim_5458.tif", "w", **dict(base, dtype="uint8", nodata=0)) as d:
        d.write(regime, 1)
    with rasterio.open(OUT / "ilmaruut_5458.tif", "w", **dict(base, dtype="uint32", nodata=0)) as d:
        d.write(np.where(forest, weather, 0).astype(np.uint32), 1)
    with rasterio.open(OUT / "tegurid_5458.tif", "w",
                       **dict(base, count=len(f), dtype="float32", nodata=np.nan)) as d:
        for i, (k, v) in enumerate(f.items(), 1):
            d.write(np.where(forest, v, np.nan).astype(np.float32), i)
            d.set_band_description(i, k)

    # summary
    s = suit[forest]
    print(f"Metsaregistri metsa: {forest.mean():.1%} testalast ({forest.sum() / 1e4:.0f} km2)")
    print("TWI protsentiilid metsas (5/25/50/75/95):", np.percentile(twi[forest], [5, 25, 50, 75, 95]).round(1))
    print("Katvus metsas (5/25/50/75/95):", np.percentile(cover[forest], [5, 25, 50, 75, 95]).round(2))
    for k, v in f.items():
        print(f"  {k:13s} keskmine {np.nanmean(v[forest]):.2f}")
    print("Sobivus (5/25/50/75/95):", np.percentile(s, [5, 25, 50, 75, 95]).round(2))
    for lo, hi, name in [(0.7, 1.01, "ideaalne/väga hea >= 0.7"), (0.4, 0.7, "hea 0.4-0.7"),
                         (0.15, 0.4, "kehv 0.15-0.4"), (0, 0.15, "sobimatu < 0.15")]:
        print(f"  {name:26s} {((s >= lo) & (s < hi)).mean():.1%} metsast")
    print("Veereziim:", {int(k): f"{v / forest.sum():.0%}" for k, v in zip(*np.unique(regime[forest], return_counts=True))})


if __name__ == "__main__":
    main()
