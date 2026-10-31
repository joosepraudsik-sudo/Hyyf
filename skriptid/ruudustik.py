"""Build the common 10 m grid (EPSG:3301) for an area (default: the test sheet, see ala.py).

Inputs (<area>/korgus, <area>/metsaregister, andmed/eesti): DTM tiles (1 m, or 5 m where 1 m is
missing, e.g. nationwide), CHM per sheet,
forest stands, soil map.
Outputs (<area>/ruudustik/):
  dtm.tif       mean elevation, m
  kalle.tif     slope, degrees
  twi.tif       topographic wetness index ln(a / tan b)
  katvus.tif    canopy cover (fraction of area with trees > 5 m), 30 m window
  korgus.tif    mean canopy height, m (newest CHM, older if missing)
  eraldis.tif   forest stand id (0 = no stand)
  muld.tif      row index into muld.csv (0 = no soil polygon)
  muld.csv      soil attributes of the polygons used

Run: uv run python -I skriptid/ruudustik.py
"""
import heapq
import re
import sys
from collections import defaultdict
from pathlib import Path
from types import SimpleNamespace

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy.ndimage import uniform_filter

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ala import BASE, TESTALA  # noqa: E402

RES = 10
CRS = "EPSG:3301"
# DTM tiles in order of preference; both are averaged onto the 10 m grid
DTM_MUSTRID = ("*_dtm_1m.tif", "*_dtm_5m.tif")


def grid_of(ala):
    return SimpleNamespace(W=(ala.x1 - ala.x0) // RES, H=(ala.y1 - ala.y0) // RES,
                           transform=from_origin(ala.x0, ala.y1, RES, RES), out=ala.grid, ala=ala)


def write(g, name, arr, nodata=None):
    profile = dict(driver="GTiff", width=g.W, height=g.H, count=1, dtype=arr.dtype, crs=CRS,
                   transform=g.transform, compress="deflate", nodata=nodata)
    with rasterio.open(g.out / name, "w", **profile) as d:
        d.write(arr, 1)
    print(f"  {name}")


def resample(g, src_path, dst_dtype=np.float32, transform_fn=None):
    """Average-resample a raster onto the 10 m grid, optionally transforming values first."""
    dst = np.full((g.H, g.W), np.nan, dtype=dst_dtype)
    with rasterio.open(src_path) as s:
        a = s.read(1).astype(np.float32)
        if s.nodata is not None:
            a[a == s.nodata] = np.nan
        if transform_fn is not None:
            a = transform_fn(a)
        reproject(a, dst, src_transform=s.transform, src_crs=s.crs, src_nodata=np.nan,
                  dst_transform=g.transform, dst_crs=CRS, dst_nodata=np.nan,
                  resampling=Resampling.average)
    return dst


def mosaic(g, files, transform_fn=None):
    out = np.full((g.H, g.W), np.nan, dtype=np.float32)
    for f in files:
        part = resample(g, f, transform_fn=transform_fn)
        ok = ~np.isnan(part)
        out[ok] = part[ok]
    return out


def chm_files(folder):
    """Per sheet: the newest CHM and the newest leaf-on (summer) CHM, falling back to the newest."""
    by_sheet = defaultdict(list)
    for f in folder.glob("*chm*.tif"):
        m = re.search(r"(\d{4})\.tif$", f.name)
        by_sheet[f.name.split("_chm")[0]].append((int(m.group(1)) if m else 0, f))
    newest, leaf_on = [], []
    for files in by_sheet.values():
        files.sort()
        newest.append(files[-1][1])
        summer = [f for _, f in files if "suvi" in f.name]
        leaf_on.append(summer[-1] if summer else files[-1][1])
    return newest, leaf_on


def fill_depressions(z, eps=1e-4):
    """Priority-flood depression filling (Barnes et al. 2014) with a small gradient."""
    h, w = z.shape
    filled = z.astype(np.float64).copy()
    closed = np.zeros((h, w), dtype=bool)
    heap = []
    for r in range(h):
        for c in (0, w - 1):
            heap.append((filled[r, c], r, c))
            closed[r, c] = True
    for c in range(1, w - 1):
        for r in (0, h - 1):
            heap.append((filled[r, c], r, c))
            closed[r, c] = True
    heapq.heapify(heap)
    fl = filled.tolist()
    cl = closed.tolist()
    nbrs = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
    push, pop = heapq.heappush, heapq.heappop
    while heap:
        zc, r, c = pop(heap)
        for dr, dc in nbrs:
            rr, cc = r + dr, c + dc
            if 0 <= rr < h and 0 <= cc < w and not cl[rr][cc]:
                cl[rr][cc] = True
                if fl[rr][cc] <= zc:
                    fl[rr][cc] = zc + eps
                push(heap, (fl[rr][cc], rr, cc))
    return np.array(fl)


def flow_accumulation(filled):
    """D8 flow accumulation in cells (each cell contributes 1)."""
    h, w = filled.shape
    pad = np.pad(filled, 1, constant_values=np.inf)
    best = np.zeros((h, w))
    rec = np.full((h, w), -1, dtype=np.int64)
    idx = np.arange(h * w).reshape(h, w)
    for dr, dc in [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]:
        nb = pad[1 + dr:1 + dr + h, 1 + dc:1 + dc + w]
        drop = (filled - nb) / np.hypot(dr, dc)
        better = drop > best
        best[better] = drop[better]
        rr = np.clip(np.arange(h)[:, None] + dr, 0, h - 1)
        cc = np.clip(np.arange(w)[None, :] + dc, 0, w - 1)
        rec[better] = idx[rr, cc][better]
    order = np.argsort(-filled, axis=None).tolist()
    acc = [1.0] * (h * w)
    r = rec.ravel().tolist()
    for i in order:
        j = r[i]
        if j >= 0:
            acc[j] += acc[i]
    return np.array(acc).reshape(h, w)


def dtm_files(folder):
    for pattern in DTM_MUSTRID:
        files = sorted(folder.glob(pattern))
        if files:
            return files
    return []


def terrain(g, files):
    """Elevation, slope (degrees) and TWI on the 10 m grid."""
    dtm = mosaic(g, files)
    gy, gx = np.gradient(dtm.astype(np.float64), RES)
    tan_b = np.hypot(gx, gy)
    kalle = np.degrees(np.arctan(tan_b)).astype(np.float32)
    acc = flow_accumulation(fill_depressions(np.nan_to_num(dtm, nan=np.nanmin(dtm))))
    twi = np.log(acc * RES / np.maximum(tan_b, 0.001)).astype(np.float32)
    return dtm, kalle, twi


def build(ala=TESTALA):
    g = grid_of(ala)
    g.out.mkdir(parents=True, exist_ok=True)
    korgus = ala.dir / "korgus"

    print("DTM, kalle, TWI")
    dtm, kalle, twi = terrain(g, dtm_files(korgus))
    write(g, "dtm.tif", dtm, np.nan)
    write(g, "kalle.tif", kalle, np.nan)
    write(g, "twi.tif", twi, np.nan)

    print("Vorastik (CHM)")
    trees = lambda a: np.where(np.isnan(a), np.nan, (a > 5).astype(np.float32))
    newest, leaf_on = chm_files(korgus)
    h_new, h_leaf = mosaic(g, newest), mosaic(g, leaf_on)
    c_new, c_leaf = mosaic(g, newest, trees), mosaic(g, leaf_on, trees)
    # leaf-on (summer) cover is better for deciduous trees; the newest scan catches newer clearcuts
    cleared = (h_new < 2) & (h_leaf > 8)
    cover = np.where(cleared, c_new, c_leaf)
    cover = np.where(np.isnan(cover), c_new, cover)
    cover = uniform_filter(np.nan_to_num(cover), size=3)
    write(g, "katvus.tif", cover.astype(np.float32), np.nan)
    write(g, "korgus.tif", np.where(np.isnan(h_new), h_leaf, h_new).astype(np.float32), np.nan)

    print("Metsaregister")
    stands = gpd.read_file(ala.dir / "metsaregister" / "eraldis.geojson")
    write(g, "eraldis.tif", rasterize(zip(stands.geometry, stands["id"].astype(np.int32)),
                                      out_shape=(g.H, g.W), transform=g.transform, fill=0, dtype=np.int32))

    print("Mullakaart")
    gdb = BASE / "andmed" / "eesti" / "muld" / "Mullakaart_GDB.zip"
    soil = gpd.read_file(f"/vsizip/{gdb.as_posix()}/Mullakaart.gdb", layer="Mullakaart",
                         bbox=ala.bbox).reset_index(drop=True)
    soil["rida"] = np.arange(1, len(soil) + 1, dtype=np.int32)
    write(g, "muld.tif", rasterize(zip(soil.geometry, soil["rida"]), out_shape=(g.H, g.W),
                                   transform=g.transform, fill=0, dtype=np.int32))
    soil.drop(columns="geometry").to_csv(g.out / "muld.csv", index=False, encoding="utf-8")
    print("  muld.csv")


if __name__ == "__main__":
    build()
