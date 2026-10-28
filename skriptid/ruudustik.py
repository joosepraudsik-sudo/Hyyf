"""Build the common 10 m grid (EPSG:3301) for the test area.

Inputs (andmed/testala_5458, andmed/eesti): DTM 1 m tiles, CHM 2021/2023, forest stands, soil map.
Outputs (andmed/testala_5458/ruudustik/):
  dtm.tif       mean elevation, m
  kalle.tif     slope, degrees
  twi.tif       topographic wetness index ln(a / tan b)
  katvus.tif    canopy cover (fraction of area with trees > 5 m), 30 m window
  korgus.tif    mean canopy height, m (CHM 2023, 2021 if missing)
  eraldis.tif   forest stand id (0 = no stand)
  muld.tif      row index into muld.csv (0 = no soil polygon)
  muld.csv      soil attributes of the polygons used

Run: uv run python -I skriptid/ruudustik.py
"""
import heapq
from pathlib import Path

import geopandas as gpd
import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.features import rasterize
from rasterio.transform import from_origin
from rasterio.warp import reproject
from scipy.ndimage import uniform_filter

ROOT = Path(__file__).resolve().parent.parent / "andmed"
AREA = ROOT / "testala_5458"
OUT = AREA / "ruudustik"

X0, Y0, X1, Y1 = 680000, 6450000, 690000, 6460000
RES = 10
W, H = (X1 - X0) // RES, (Y1 - Y0) // RES
TRANSFORM = from_origin(X0, Y1, RES, RES)
CRS = "EPSG:3301"


def write(name, arr, nodata=None):
    profile = dict(driver="GTiff", width=W, height=H, count=1, dtype=arr.dtype, crs=CRS,
                   transform=TRANSFORM, compress="deflate", nodata=nodata)
    with rasterio.open(OUT / name, "w", **profile) as d:
        d.write(arr, 1)
    print(f"  {name}")


def resample(src_path, dst_dtype=np.float32, transform_fn=None):
    """Average-resample a raster onto the 10 m grid, optionally transforming values first."""
    dst = np.full((H, W), np.nan, dtype=dst_dtype)
    with rasterio.open(src_path) as s:
        a = s.read(1).astype(np.float32)
        if s.nodata is not None:
            a[a == s.nodata] = np.nan
        if transform_fn is not None:
            a = transform_fn(a)
        reproject(a, dst, src_transform=s.transform, src_crs=s.crs, src_nodata=np.nan,
                  dst_transform=TRANSFORM, dst_crs=CRS, dst_nodata=np.nan,
                  resampling=Resampling.average)
    return dst


def build_dtm():
    dtm = np.full((H, W), np.nan, dtype=np.float32)
    for f in sorted((AREA / "korgus").glob("*_dtm_1m.tif")):
        part = resample(f)
        ok = ~np.isnan(part)
        dtm[ok] = part[ok]
    return dtm


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


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    print("DTM, kalle, TWI")
    dtm = build_dtm()
    write("dtm.tif", dtm, np.nan)
    gy, gx = np.gradient(dtm.astype(np.float64), RES)
    tan_b = np.hypot(gx, gy)
    write("kalle.tif", np.degrees(np.arctan(tan_b)).astype(np.float32), np.nan)
    acc = flow_accumulation(fill_depressions(np.nan_to_num(dtm, nan=np.nanmin(dtm))))
    twi = np.log(acc * RES / np.maximum(tan_b, 0.001))
    write("twi.tif", twi.astype(np.float32), np.nan)

    print("Vorastik (CHM)")
    trees = lambda a: np.where(np.isnan(a), np.nan, (a > 5).astype(np.float32))
    h21 = resample(AREA / "korgus" / "5458_chm_suvi_2021.tif")
    h23 = resample(AREA / "korgus" / "5458_chm_kevad_2023.tif")
    c21 = resample(AREA / "korgus" / "5458_chm_suvi_2021.tif", transform_fn=trees)
    c23 = resample(AREA / "korgus" / "5458_chm_kevad_2023.tif", transform_fn=trees)
    # 2021 is leaf-on (better for deciduous cover); 2023 catches newer clearcuts.
    cleared = (h23 < 2) & (h21 > 8)
    cover = np.where(cleared, c23, c21)
    cover = np.where(np.isnan(cover), c23, cover)
    cover = uniform_filter(np.nan_to_num(cover), size=3)
    write("katvus.tif", cover.astype(np.float32), np.nan)
    write("korgus.tif", np.where(np.isnan(h23), h21, h23).astype(np.float32), np.nan)

    print("Metsaregister")
    stands = gpd.read_file(AREA / "metsaregister" / "eraldis.geojson")
    write("eraldis.tif", rasterize(zip(stands.geometry, stands["id"].astype(np.int32)),
                                   out_shape=(H, W), transform=TRANSFORM, fill=0, dtype=np.int32))

    print("Mullakaart")
    gdb = ROOT / "eesti" / "muld" / "Mullakaart_GDB.zip"
    soil = gpd.read_file(f"/vsizip/{gdb.as_posix()}/Mullakaart.gdb", layer="Mullakaart",
                         bbox=(X0, Y0, X1, Y1)).reset_index(drop=True)
    soil["rida"] = np.arange(1, len(soil) + 1, dtype=np.int32)
    write("muld.tif", rasterize(zip(soil.geometry, soil["rida"]), out_shape=(H, W),
                                transform=TRANSFORM, fill=0, dtype=np.int32))
    soil.drop(columns="geometry").to_csv(OUT / "muld.csv", index=False, encoding="utf-8")
    print("  muld.csv")


if __name__ == "__main__":
    main()
