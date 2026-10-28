"""Export test area data for the web page (leht/andmed/).

The display value is linear in the fruiting index, so per 50 m cell we store, for each water
regime class c, the neighbourhood mean of suitability * [class == c]. The browser computes
  value = sum_c index(point, c, day) * S_c
which equals soojuskaart.py exactly, without one map per day.

  kasvukoht_5458.bin   uint8, bands x rows x cols: S_1..S_5 (0..255), weather point (255 = no forest)
  kasvukoht_5458.json  grid size, corner coordinates (lon, lat), band layout
  viljumine_5458.json  dates, points, index per date as uint8 [point][class]

Run: uv run python -I skriptid/eksport.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402
from lae_testala import ILMAPUNKTID  # noqa: E402
from soojuskaart import BLOCK, MIN_FOREST, RES, nearest_point, neighbourhood  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "valjund"
WEB = BASE / "leht" / "andmed"
CLASSES = sorted(P.VEEREZIIM)
MONTHS = (6, 10)   # June..October


def main():
    WEB.mkdir(parents=True, exist_ok=True)
    with rasterio.open(OUT / "sobivus_5458.tif") as d:
        suit, t = d.read(1), d.transform
    with rasterio.open(OUT / "veereziim_5458.tif") as d:
        regime = d.read(1)
    forest = ~np.isnan(suit)

    bands = []
    for c in CLASSES:
        bands.append(neighbourhood(np.where(forest & (regime == c), suit, 0), forest))
    stack = np.nan_to_num(np.array(bands))
    shown = np.isfinite(bands[0])

    names, point_idx = nearest_point(t, suit.shape)
    h, w = shown.shape
    centre = point_idx[BLOCK // 2::BLOCK, BLOCK // 2::BLOCK][:h, :w]
    point_band = np.where(shown, centre, 255)
    data = np.concatenate([np.round(np.clip(stack, 0, 1) * 255), point_band[None]]).astype(np.uint8)
    (WEB / "kasvukoht_5458.bin").write_bytes(data.tobytes())

    to_ll = Transformer.from_crs("EPSG:3301", "EPSG:4326", always_xy=True)
    x0, y1 = t.c, t.f
    x1, y0 = x0 + w * BLOCK * RES, y1 - h * BLOCK * RES
    corners = [to_ll.transform(x, y) for x, y in [(x0, y1), (x1, y1), (x1, y0), (x0, y0)]]
    meta = {
        "nimi": "Testala 5458 (Põlvamaa)",
        "laius": w, "korgus": h, "ruut_m": BLOCK * RES,
        "nurgad": [[round(lon, 6), round(lat, 6)] for lon, lat in corners],  # NW, NE, SE, SW
        "kihid": [f"S{c}" for c in CLASSES] + ["ilmapunkt"],
        "klassid": {c: P.VEEREZIIM[c]["nimi"] for c in CLASSES},
        "ilmapunktid": names,
        "min_mets": MIN_FOREST,
    }
    (WEB / "kasvukoht_5458.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), "utf-8")

    fr = pd.read_csv(OUT / "viljumine_5458.csv", parse_dates=["kuupaev"])
    fr = fr[fr["kuupaev"].dt.month.between(*MONTHS)]
    cube = fr.pivot_table(index="kuupaev", columns=["punkt", "klass"], values="indeks")
    cube = cube.reindex(columns=pd.MultiIndex.from_product([names, CLASSES]))
    values = np.round(cube.to_numpy() * 255).astype(int).reshape(len(cube), len(names), len(CLASSES))
    out = {
        "allikas": "ERA5 / ERA5-Land (Open-Meteo), arendusandmed",
        "kuupaevad": [f"{d:%Y-%m-%d}" for d in cube.index],
        "ilmapunktid": names,
        "klassid": CLASSES,
        "indeks": values.tolist(),
    }
    (WEB / "viljumine_5458.json").write_text(json.dumps(out, separators=(",", ":")), "utf-8")

    for f in sorted(WEB.iterdir()):
        print(f"  {f.name}: {f.stat().st_size / 1024:.0f} KB")
    print(f"50 m ruute metsaga: {shown.sum()}, kuupäevi: {len(cube)}")


if __name__ == "__main__":
    main()
