"""A small test area around one point, shown on the page like the test sheet.

Downloads the data for a window around the point (heights, forest register, weather; the soil
map is the national file), runs the same site and fruiting models and exports the inner box to
leht/andmed/<nimi>.js. The model runs on a wider window than is shown, so neighbourhood factors
(forest continuity 300 m, mire distance) are not cut off at the edge.

Open the page with ?ala=<nimi>, e.g. http://localhost:8000/?ala=proov_589056_6602827

Run: uv run python -I skriptid/proovala.py 59.55356 25.57488 [--kulg 1000] [--varu 400] [--nimi NIMI] [--silt "Hara (Lahemaa)"]
"""
import argparse
import sys
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import eksport  # noqa: E402
import kasvukoht  # noqa: E402
import parameetrid as P  # noqa: E402
import ruudustik  # noqa: E402
from ala import Ala, lehed_10k, lehed_20k  # noqa: E402
from lae_testala import lae_ilm, lae_korgus, lae_metsaregister, lae_muld  # noqa: E402
from viljumine import load_weather, simulate  # noqa: E402

ILMA_ALGUS = "2025-01-01"   # degree days count from 1 January; last season and this one


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lat", type=float)
    ap.add_argument("lon", type=float)
    ap.add_argument("--kulg", type=int, default=1000, help="shown square, m")
    ap.add_argument("--varu", type=int, default=400, help="extra margin computed around it, m")
    ap.add_argument("--nimi", help="file name, default proov_<E>_<N>")
    ap.add_argument("--silt", help="name shown on the page")
    a = ap.parse_args()

    x, y = Transformer.from_crs("EPSG:4326", "EPSG:3301", always_xy=True).transform(a.lon, a.lat)
    cx, cy = round(x / 50) * 50, round(y / 50) * 50          # 50 m display cells
    pool = a.kulg // 2
    nimi = a.nimi or f"proov_{round(x)}_{round(y)}"
    kast = (cx - pool, cy - pool, cx + pool, cy + pool)
    r = pool + a.varu
    ala = Ala(nimi, cx - r, cy - r, cx + r, cy + r, f"proov/{nimi}", "proov")
    print(f"{nimi}: näidatakse {a.kulg} m ruut, arvutatakse {2 * r} m (L-EST97 {kast})")
    print(f"  kaardilehed: DTM {lehed_10k(ala)}, CHM {lehed_20k(ala)}")

    print("1/5 Kõrgusandmed ja võrastik")
    lae_korgus(ala)
    print("2/5 Metsaregister")
    lae_metsaregister(ala)
    lae_muld()
    print("3/5 Ruudustik ja kasvukoht")
    ruudustik.build(ala)
    kasvukoht.run(ala)

    print("4/5 Ilm ja viljumine")
    punktid = {"keskel": (a.lat, a.lon)}
    wx_dir = ala.dir / "ilm"
    lae_ilm(wx_dir, punktid, algus=ILMA_ALGUS, lopp=(date.today() - timedelta(days=1)).isoformat())
    wx = load_weather("keskel", wx_dir)
    rows = []
    for c in P.VEEREZIIM:
        d = simulate(wx, c)
        d["allikas"] = wx["allikas"]
        d.insert(0, "klass", c)
        d.insert(0, "punkt", "keskel")
        rows.append(d)
    pd.concat(rows).rename_axis("kuupaev").reset_index().to_csv(
        ala.valjund / f"viljumine_{nimi}.csv", float_format="%.4f", index=False)

    print("5/5 Eksport lehele")
    eksport.main(ala, punktid, nimi=a.silt or f"Proovala {a.lat:.5f}, {a.lon:.5f}", fail=nimi, kast=kast)
    print(f"\nAva: http://localhost:8000/?ala={nimi}")


if __name__ == "__main__":
    main()
