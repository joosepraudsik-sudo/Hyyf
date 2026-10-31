"""Grid and site model for all of Estonia, one 1:20 000 sheet at a time.

Each sheet with forest stands is computed with a VARU margin, so TWI, forest continuity and
mire distance are not cut off at the sheet edge, then cropped to the sheet:
  andmed/eesti/lehed/<leht>/ruudustik/   katvus, korgus, twi, eraldis, muld (+ muld.csv)
  valjund/eesti/<kiht>_<leht>.tif         sobivus, veereziim, ilmaruut, soo_kaugus, tegurid
  valjund/eesti/logi/<leht>.txt          model summary of the sheet
Inputs come from lae_eesti.py. Finished sheets are skipped, so the run can be restarted.
Run: uv run python -I skriptid/eesti.py [--too 4] [leht ...]
"""
import argparse
import contextlib
import json
import shutil
import sys
import time
import traceback
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

import geopandas as gpd
import pandas as pd
import rasterio
from rasterio.windows import from_bounds

sys.path.insert(0, str(Path(__file__).resolve().parent))
import kasvukoht  # noqa: E402
import ruudustik  # noqa: E402
from ala import BASE, Ala, lehed_20k  # noqa: E402
from lae_eesti import LEHED_JSON, MRD, sheets  # noqa: E402

VARU = 500                       # m around the sheet: forest continuity 300 m, mire distance 400 m
VALJUND = BASE / "valjund" / "eesti"
LEHED = BASE / "andmed" / "eesti" / "lehed"
ELEMENDID = MRD / "eraldis_element.pkl"
EL_VEERUD = ["eraldis_id", "rinne_kood", "puuliik_kood", "osakaal", "vanus", "korgus", "diameeter", "enamus"]
RUUDUSTIK = ["katvus.tif", "korgus.tif", "twi.tif", "eraldis.tif", "muld.tif"]
KIHID = ["sobivus", "veereziim", "ilmaruut", "soo_kaugus", "tegurid"]

EL = None   # stand composition, sorted by eraldis_id (per worker process)


def koosta_elemendid():
    """All composition pages in one compact table (the pages are ~2 GB of JSON)."""
    parts = []
    for f in sorted((MRD / "eraldis_element").glob("osa_*.json")):
        parts.append(pd.DataFrame(json.loads(f.read_text("utf-8")), columns=EL_VEERUD))
    el = pd.concat(parts, ignore_index=True)
    for c in ["rinne_kood", "puuliik_kood"]:
        el[c] = el[c].astype("category")
    el.sort_values("eraldis_id").reset_index(drop=True).to_pickle(ELEMENDID)
    print(f"  koosseisu ridu {len(el)}")


def lae_elemendid():
    global EL
    EL = pd.read_pickle(ELEMENDID)


def valmis(leht):
    return all((VALJUND / f"{k}_{leht}.tif").exists() for k in KIHID)


def loika(src: Path, dst: Path, bounds):
    """Copy the part of a raster inside bounds (the sheet) to dst."""
    with rasterio.open(src) as s:
        w = from_bounds(*bounds, s.transform).round_offsets().round_lengths()
        prof = dict(s.profile, width=int(w.width), height=int(w.height),
                    transform=s.window_transform(w), compress="deflate")
        prof.pop("blockxsize", None), prof.pop("blockysize", None), prof.pop("tiled", None)
        data, desc = s.read(window=w), s.descriptions
    dst.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dst, "w", **prof) as d:
        d.write(data)
        for i, t in enumerate(desc, 1):
            if t:
                d.set_band_description(i, t)


def arvuta(leht, bbox):
    x0, y0, x1, y1 = bbox
    ala = Ala(leht, x0 - VARU, y0 - VARU, x1 + VARU, y1 + VARU, f"eesti/too/{leht}",
              f"eesti/too/{leht}", korgus_kaust="eesti/korgus")
    md = ala.dir / "metsaregister"
    md.mkdir(parents=True, exist_ok=True)

    # stands of this and neighbouring sheets inside the computed window (edge stands are in both files)
    parts = [gpd.read_file(f, bbox=ala.bbox) for s in lehed_20k(ala)
             if (f := MRD / "lehed" / f"{s}.geojson").exists()]
    stands = pd.concat(parts, ignore_index=True).drop_duplicates("id")
    stands.to_file(md / "eraldis.geojson", driver="GeoJSON")
    ids = stands["id"].to_numpy()
    lo, hi = EL["eraldis_id"].searchsorted(ids.min()), EL["eraldis_id"].searchsorted(ids.max(), side="right")
    el = EL.iloc[lo:hi]
    el = el[el["eraldis_id"].isin(ids)]
    (md / "eraldis_element.json").write_text(el.astype(object).where(el.notna(), None)
                                             .to_json(orient="records", force_ascii=False), encoding="utf-8")

    VALJUND.joinpath("logi").mkdir(parents=True, exist_ok=True)
    with open(VALJUND / "logi" / f"{leht}.txt", "w", encoding="utf-8") as log, contextlib.redirect_stdout(log):
        print(f"Leht {leht}, arvutusala {ala.bbox} (varu {VARU} m), eraldisi {len(stands)}, koosseisu ridu {len(el)}")
        ruudustik.build(ala)
        kasvukoht.run(ala)

    grid_out = LEHED / leht / "ruudustik"
    for name in RUUDUSTIK:
        loika(ala.grid / name, grid_out / name, bbox)
    shutil.copy(ala.grid / "muld.csv", grid_out / "muld.csv")
    # sobivus last: valmis() checks all layers
    for k in reversed(KIHID):
        loika(ala.valjund / f"{k}_{leht}.tif", VALJUND / f"{k}_{leht}.tif", bbox)
    shutil.rmtree(ala.dir)
    shutil.rmtree(ala.valjund)
    return len(stands)


def too(leht, bbox):
    t = time.time()
    try:
        return leht, arvuta(leht, bbox), time.time() - t, None
    except Exception:  # noqa: BLE001
        return leht, 0, time.time() - t, traceback.format_exc()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lehed", nargs="*", help="only these sheets (default: all with forest)")
    ap.add_argument("--too", type=int, default=4, help="parallel processes")
    a = ap.parse_args()

    if not ELEMENDID.exists():
        print("Koosseisu tabel")
        koosta_elemendid()
    counts = json.loads(LEHED_JSON.read_text())
    bboxes = dict(sheets())
    lehed = a.lehed or sorted(k for k, n in counts.items() if n)
    todo = [s for s in lehed if not valmis(s)]
    print(f"Lehti {len(lehed)}, arvutada {len(todo)}, protsesse {a.too}")
    vead = []
    t0 = time.time()
    with ProcessPoolExecutor(a.too, initializer=lae_elemendid) as ex:
        futs = [ex.submit(too, s, bboxes[s]) for s in todo]
        for i, fut in enumerate(as_completed(futs), 1):
            leht, n, sek, err = fut.result()
            if err:
                vead.append(leht)
                print(f"  {leht} VIGA ({i}/{len(todo)}):\n{err}")
            else:
                jaanud = (time.time() - t0) / i * (len(todo) - i) / 60
                print(f"  {leht}: {n} eraldist, {sek:.0f} s ({i}/{len(todo)}, jäänud ~{jaanud:.0f} min)")
    print(f"\nValmis. Vigu {len(vead)}{': ' + ' '.join(vead) if vead else ''}")


if __name__ == "__main__":
    main()
