"""Export all of Estonia for the web page, one 1:20 000 sheet (10 km) per file, loaded on demand.

leht/andmed/eesti/
  indeks.json.gz      meta, sheet list (corners, weather nodes), overview grid, guide
  ilm.json.gz         dates, sources, weather per day and node (same fields as eksport.py)
  ilm.bin.gz          uint8 [day][node][class][field]
  ylevaade.bin.gz     overview for small zoom: Web Mercator grid of YLE_M (about 260 m on the ground),
                      per cell the mean S_c of its good forest (Koht >= the lowest forest step), the
                      number of such 50 m cells and the weather node of the best one
  kaart/<leht>.bin.gz map layers S_c and weather node (local index into the sheet's list, 255 = none),
                      208 x 208 cells: the sheet's 200 x 200 plus VARU cells from the neighbours, so
                      the smoothed drawing has no seams at sheet edges
  info/<leht>.json.gz click explanation: factor scores and inputs per 50 m cell, stand and soil tables

The neighbourhood (100 m) is computed on a mosaic of the sheet and its neighbours, so the values
match a computation over the whole country. Files are gzip, the page unpacks them itself
(DecompressionStream), so any static host works. Each also has a .js copy for opening index.html
straight from disk (js_koopiad, --js).

Run: uv run python -I skriptid/eksport_eesti.py [leht ...] [--too 4]
"""
import argparse
import base64
import gzip
import json
import math
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402
from eksport import (CLASSES, MONTHS, MULLATEMP_SKAALA, TIME_COLS, WEB, block_mean,  # noqa: E402
                     block_mode, guide, soil_text, to_u8)
from ilmavork import ILM, PUNKTID, VALJUND  # noqa: E402
from kasvukoht import forest_share, stand_table  # noqa: E402
from lae_eesti import LEHED_JSON, MRD, sheets  # noqa: E402
from soojuskaart import BLOCK, MIN_FOREST, RES, neighbourhood  # noqa: E402

OUT = WEB / "eesti"
LEHED = Path(__file__).resolve().parent.parent / "andmed" / "eesti" / "lehed"
SHEET = 10000
VARU = 4                         # 50 m cells from the neighbours around each sheet's map file
MOSAIIK = 300                    # m of neighbour data read around a sheet (VARU cells + 100 m)
YLE_M = 500                      # overview cell in Web Mercator metres (~260 m on the ground at 58.5 N)
EL = None

to_ll = Transformer.from_crs("EPSG:3301", "EPSG:4326", always_xy=True)
to_merc = Transformer.from_crs("EPSG:3301", "EPSG:3857", always_xy=True)


def gz(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(gzip.compress(data if isinstance(data, bytes) else data.encode("utf-8"), 9, mtime=0))


def mosaic(name, bbox, nodata=np.nan, dtype=np.float32):
    """Band 1 of valjund/eesti/<name>_<sheet>.tif (or a sheet grid file, name 'ruudustik/x') over the
    sheet plus MOSAIIK m, pasted together from the sheet and its neighbours."""
    m = MOSAIIK // RES
    n = SHEET // RES
    out = np.full((n + 2 * m, n + 2 * m), nodata, dtype=dtype)
    x0, y0 = bbox[0], bbox[1]
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            leht = BY_BBOX.get((x0 + dx * SHEET, y0 + dy * SHEET))
            if leht is None:
                continue
            f = (LEHED / leht / f"{name}.tif") if name.startswith("ruudustik/") else VALJUND / f"{name}_{leht}.tif"
            if not f.exists():
                continue
            with rasterio.open(f) as d:
                a = d.read(1)
            assert a.shape == (n, n), (f, a.shape)
            # rows run north to south: dy = +1 (north) is at the top
            r0, c0 = m + (-dy) * n, m + dx * n
            rs, cs = slice(max(r0, 0), min(r0 + n, out.shape[0])), slice(max(c0, 0), min(c0 + n, out.shape[1]))
            out[rs, cs] = a[rs.start - r0:rs.stop - r0, cs.start - c0:cs.stop - c0]
    return out


def lehe_tabelid(leht, stand_ids, site_names):
    st = gpd.read_file(MRD / "lehed" / f"{leht}.geojson", ignore_geometry=True)
    st = st[st["id"].isin(stand_ids)].drop_duplicates("id")
    ids = st["id"].to_numpy()
    if len(ids):
        lo, hi = EL["eraldis_id"].searchsorted(ids.min()), EL["eraldis_id"].searchsorted(ids.max(), side="right")
        el = EL.iloc[lo:hi]
        el = el[el["eraldis_id"].isin(ids)]
    else:
        el = EL.iloc[:0]
    tab = stand_table(st=st, el=pd.DataFrame(el)).reindex(stand_ids)
    return [{"koosseis": r.koosseis if isinstance(r.koosseis, str) else "",
             "vanus": None if pd.isna(r.vanus_a) else int(r.vanus_a),
             "kasvukoht": site_names.get(r.kasvukoht_kood, r.kasvukoht_kood) if isinstance(r.kasvukoht_kood, str) else ""}
            for r in tab.itertuples()]


def leht_valja(leht, bbox, nodes, site_names, yle):
    """Write the sheet's map and info files, return its index entry and overview cells."""
    m = MOSAIIK // RES
    n = SHEET // RES
    nb = n // BLOCK                       # 200 cells of 50 m
    mb = m // BLOCK                       # 6 cells of margin in the mosaic
    suit = mosaic("sobivus", bbox)
    regime = mosaic("veereziim", bbox, 0, np.uint8)
    node = mosaic("ilmaruut", bbox, 0, np.uint32)
    forest = ~np.isnan(suit)
    s_c = [neighbourhood(np.where(forest & (regime == c), suit, 0), forest) for c in CLASSES]
    shown = np.isfinite(s_c[0])
    centre = node[BLOCK // 2::BLOCK, BLOCK // 2::BLOCK][:shown.shape[0], :shown.shape[1]]
    centre = np.where(shown, centre, 0)

    # map file: the sheet with VARU cells around it
    cut = (slice(mb - VARU, mb + nb + VARU),) * 2
    ids = sorted(int(x) for x in np.unique(centre[cut]) if x)
    local = np.full(centre.shape, 255, np.uint8)
    for k, x in enumerate(ids):
        local[centre == x] = k
    kaart = np.stack([to_u8(s[cut]) for s in s_c] + [local[cut]])
    gz(OUT / "kaart" / f"{leht}.bin.gz", kaart.tobytes())

    # overview: good forest cells of the sheet itself into the Web Mercator grid
    inner = (slice(mb, mb + nb),) * 2
    S = np.stack([np.nan_to_num(s[inner]) for s in s_c])
    koht = S.sum(0)
    good = shown[inner] & (koht >= P.KLASS_KOHT[-1])
    yy, xx = np.nonzero(good)
    cells = []
    if len(yy):
        x = bbox[0] + (xx + 0.5) * BLOCK * RES
        y = bbox[3] - (yy + 0.5) * BLOCK * RES
        mx, my = to_merc.transform(x, y)
        cx = ((mx - yle["x0"]) // YLE_M).astype(int)
        cy = ((yle["y1"] - my) // YLE_M).astype(int)
        cells = list(zip(cy.tolist(), cx.tolist(), S[:, yy, xx].T.tolist(), koht[yy, xx].tolist(),
                         centre[inner][yy, xx].tolist()))

    # info file: the sheet's own cells, unsmoothed block means and modes for the explanation
    f_sheet = forest[m:m + n, m:m + n]
    with rasterio.open(VALJUND / f"tegurid_{leht}.tif") as d:
        factors = {d.descriptions[i]: d.read(i + 1) for i in range(d.count)}
    grid = LEHED / leht / "ruudustik"
    read1 = lambda f: rasterio.open(f).read(1)
    cover_m = mosaic("ruudustik/katvus", bbox)
    cover = cover_m[m:m + n, m:m + n]
    share = forest_share(np.nan_to_num(cover_m), RES)[m:m + n, m:m + n]
    stand_mode = block_mode(read1(grid / "eraldis.tif").astype(np.int64), f_sheet)
    soil_mode = block_mode(read1(grid / "muld.tif").astype(np.int64), f_sheet)
    stand_ids = np.unique(stand_mode[stand_mode > 0])
    soil_rows = np.unique(soil_mode[soil_mode > 0])
    stand_ref = np.where(stand_mode > 0, np.searchsorted(stand_ids, stand_mode) + 1, 0)
    soil_ref = np.where(soil_mode > 0, np.searchsorted(soil_rows, soil_mode) + 1, 0)
    layers = {}
    for k, a in factors.items():
        layers[f"t_{k}"] = to_u8(block_mean(a, f_sheet))
    layers["katvus"] = to_u8(block_mean(cover, f_sheet), 100)
    layers["twi"] = np.round(np.clip(np.nan_to_num(block_mean(read1(grid / "twi.tif"), f_sheet)), 0, 25.5) * 10).astype(np.uint8)
    layers["metsaosa"] = to_u8(block_mean(share, f_sheet), 100)
    layers["soo_10m"] = np.round(np.clip(np.nan_to_num(block_mean(read1(VALJUND / f"soo_kaugus_{leht}.tif"), f_sheet)) / 10, 0, 255)).astype(np.uint8)
    layers["klass"] = block_mode(regime[m:m + n, m:m + n].astype(np.int64), f_sheet).astype(np.uint8)
    for name, ref in [("eraldis", stand_ref), ("muld", soil_ref)]:
        layers[f"{name}_lo"] = (ref & 255).astype(np.uint8)
        layers[f"{name}_hi"] = (ref >> 8).astype(np.uint8)
    soil = pd.read_csv(grid / "muld.csv", encoding="utf-8").set_index("rida").reindex(soil_rows)
    info = {"kihid": list(layers),
            "rakud": base64.b64encode(np.stack(list(layers.values())).tobytes()).decode("ascii"),
            "eraldised": lehe_tabelid(leht, stand_ids, site_names),
            "mullad": [soil_text(r.Sif1, r.Lihtloimis) for r in soil.itertuples()]}
    gz(OUT / "info" / f"{leht}.json.gz", json.dumps(info, ensure_ascii=False, separators=(",", ":")))

    x0, y0, x1, y1 = bbox
    corners = [to_ll.transform(x, y) for x, y in [(x0, y1), (x1, y1), (x1, y0), (x0, y0)]]
    entry = {"id": leht, "nurgad": [[round(a, 6), round(b, 6)] for a, b in corners],
             "punktid": [nodes.index(str(x)) for x in ids], "rakke": int(shown[inner].sum()),
             "koht_astmed": [int((shown[inner] & (koht >= t)).sum()) for t in P.KLASS_KOHT]}
    return entry, cells


def init():
    global EL, BY_BBOX
    EL = pd.read_pickle(MRD / "eraldis_element.pkl")
    BY_BBOX = {b[:2]: s for s, b in sheets()}


BY_BBOX = {}   # (x0, y0) of a sheet -> its number (set per worker process)


def too(args):
    leht, bbox, nodes, site_names, yle = args
    return leht, *leht_valja(leht, bbox, nodes, site_names, yle)


def ilm(nodes):
    fr = pd.read_csv(VALJUND / "viljumine.csv.gz", parse_dates=["kuupaev"])
    fr = fr[fr["kuupaev"].dt.month.between(*MONTHS)]
    fr["punkt"] = fr["punkt"].astype(str)
    cube = fr.pivot_table(index="kuupaev", columns=["punkt", "klass"], values=TIME_COLS)
    days = cube.index
    arr = np.stack([cube[col].reindex(columns=pd.MultiIndex.from_product([nodes, CLASSES])).to_numpy()
                    .reshape(len(days), len(nodes), len(CLASSES)) for col in TIME_COLS], axis=-1)
    k = TIME_COLS.index("kypseb")
    arr[..., k] = np.where(np.isnan(arr[..., k]), 255, np.minimum(arr[..., k], 254)) / 255
    arr[..., TIME_COLS.index("mullatemp")] /= MULLATEMP_SKAALA
    gz(OUT / "ilm.bin.gz", to_u8(arr).tobytes())
    source = fr.groupby("kuupaev")["allikas"].agg(lambda s: s.mode()[0]).reindex(days)
    first = fr[fr["klass"] == CLASSES[0]]
    out = {
        "allikas": "ERA5 / ERA5-Land kuni ~5 päeva tagasi, edasi mudelianalüüs ja prognoos (Open-Meteo), arendusandmed",
        "tana": f"{pd.Timestamp.today().normalize():%Y-%m-%d}",
        "paeva_allikas": source.fillna("era5").tolist(),
        "kuupaevad": [f"{x:%Y-%m-%d}" for x in days],
        "ilmapunktid": [int(x) for x in nodes],
        "klassid": CLASSES,
        "valjad": TIME_COLS,
        "ilm": {col: np.round(first.pivot_table(index="kuupaev", columns="punkt", values=col)
                              .reindex(index=days, columns=nodes).to_numpy(), nd).tolist()
                for col, nd in (("sademed", 1), ("temp", 1), ("tmin", 1), ("kp", 0))},
        "mullatemp_skaala": MULLATEMP_SKAALA,
        "kypseb_markus": "kypseb: paevi kuni korjatav = vaartus*255, 255 = ei kupse (liiga jahe)",
    }
    gz(OUT / "ilm.json.gz", json.dumps(out, separators=(",", ":")).replace("NaN", "null"))
    return len(days)


def js_koopiad():
    """Each .gz file also as a script (<name>.js: HYYF_FAIL("<path>", "<base64>")), so the page works
    when index.html is opened straight from disk (file:// allows script tags, not fetch). Only for
    local use: the web host gets the .gz files."""
    n = 0
    for f in OUT.rglob("*.gz"):
        js = f.with_suffix(".js")
        if js.exists() and js.stat().st_mtime >= f.stat().st_mtime:
            continue
        rel = f.relative_to(OUT).as_posix()
        data = base64.b64encode(f.read_bytes()).decode("ascii")
        js.write_text(f'HYYF_FAIL("{rel}","{data}");\n', "ascii")
        n += 1
    print(f"  .js koopiaid uuendatud {n}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("lehed", nargs="*", help="only these sheets (index and overview then cover only them)")
    ap.add_argument("--too", type=int, default=4, help="parallel processes")
    ap.add_argument("--js", action="store_true", help="only write the .js copies of existing files")
    a = ap.parse_args()
    if a.js:
        js_koopiad()
        return
    t0 = time.time()
    nodes = sorted(json.loads(PUNKTID.read_text("utf-8")), key=int)
    counts = json.loads(LEHED_JSON.read_text())
    bboxes = dict(sheets())
    lehed = a.lehed or sorted(s for s in counts if counts[s] and (VALJUND / f"sobivus_{s}.tif").exists())
    kl = json.loads((MRD / "kl_kasvukoht.json").read_text("utf-8"))
    site_names = {f["properties"]["kood"]: f["properties"]["kirjeldus"] for f in kl["features"]}

    # overview grid in Web Mercator over all sheets
    xs = [bboxes[s][i] for s in lehed for i in (0, 2)]
    ys = [bboxes[s][i] for s in lehed for i in (1, 3)]
    mx, my = to_merc.transform([min(xs), max(xs), min(xs), max(xs)], [min(ys), min(ys), max(ys), max(ys)])
    x0, x1 = math.floor(min(mx) / YLE_M) * YLE_M, math.ceil(max(mx) / YLE_M) * YLE_M
    y0, y1 = math.floor(min(my) / YLE_M) * YLE_M, math.ceil(max(my) / YLE_M) * YLE_M
    yle = {"x0": x0, "y1": y1, "laius": int((x1 - x0) // YLE_M), "korgus": int((y1 - y0) // YLE_M)}
    W, H = yle["laius"], yle["korgus"]
    S_sum = np.zeros((len(CLASSES), H, W))
    count = np.zeros((H, W), np.int32)
    best = np.zeros((H, W))
    best_node = np.zeros((H, W), np.int64)

    print(f"Ilm: {ilm(nodes)} päeva, {len(nodes)} punkti ({time.time() - t0:.0f} s)")
    entries = []
    with ProcessPoolExecutor(a.too, initializer=init) as ex:
        jobs = [(s, bboxes[s], nodes, site_names, yle) for s in lehed]
        for i, (leht, entry, cells) in enumerate(ex.map(too, jobs, chunksize=2), 1):
            entries.append(entry)
            for cy, cx, s, k, nd in cells:
                S_sum[:, cy, cx] += s
                count[cy, cx] += 1
                if k > best[cy, cx]:
                    best[cy, cx], best_node[cy, cx] = k, nd
            if i % 25 == 0 or i == len(jobs):
                print(f"  {i}/{len(jobs)} lehte, {time.time() - t0:.0f} s")

    with np.errstate(invalid="ignore"):
        S_mean = np.where(count > 0, S_sum / np.maximum(count, 1), 0)
    node_idx = {int(x): k for k, x in enumerate(nodes)}
    nd = np.vectorize(lambda v: node_idx.get(int(v), 65535), otypes=[np.uint16])(best_node)
    nd[count == 0] = 65535
    yle_bytes = (np.stack([to_u8(s) for s in S_mean]).tobytes() + np.minimum(count, 255).astype(np.uint8).tobytes()
                 + nd.astype("<u2").tobytes())
    gz(OUT / "ylevaade.bin.gz", yle_bytes)
    merc_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    (lw, lt), (le, lb) = merc_ll.transform(x0, y1), merc_ll.transform(x1, y0)
    yle.update({"nurgad": [[lw, lt], [le, lt], [le, lb], [lw, lb]], "ruut_m": YLE_M,
                "kihid": [f"S{c}" for c in CLASSES] + ["rakke", "ilmapunkt"],
                "markus": "S_c = hea metsa (Koht >= madalaim metsa aste) 50 m ruutude keskmine, rakke = nende arv (0,25 ha), ilmapunkt uint16 LE"})

    indeks = {
        "nimi": "Kogu Eesti",
        "meta": {"ruut_m": BLOCK * RES, "laius": SHEET // RES // BLOCK, "varu": VARU,
                 "kihid": [f"S{c}" for c in CLASSES] + ["ilmapunkt"],
                 "klassid": {c: P.VEEREZIIM[c]["nimi"] for c in CLASSES},
                 "piiravad": list(P.PIIRAVAD), "kaalud": P.KAALUD,
                 "astmed": {"koht": P.KLASS_KOHT, "aeg": P.KLASS_AEG}, "min_mets": MIN_FOREST},
        "lehed": sorted(entries, key=lambda e: e["id"]),
        "ylevaade": yle,
        "juhend": guide(site_names),
    }
    gz(OUT / "indeks.json.gz", json.dumps(indeks, ensure_ascii=False, separators=(",", ":")))
    js_koopiad()

    size = lambda p: sum(f.stat().st_size for f in p.glob("*.gz")) / 1e6
    print(f"Valmis {time.time() - t0:.0f} s: lehti {len(entries)}, ülevaade {W} x {H} (hea metsaga {int((count > 0).sum())})")
    for f in ["indeks.json.gz", "ilm.json.gz", "ilm.bin.gz", "ylevaade.bin.gz"]:
        print(f"  {f}: {(OUT / f).stat().st_size / 1024:.0f} KB")
    print(f"  kaart/: {size(OUT / 'kaart'):.1f} MB, info/: {size(OUT / 'info'):.1f} MB")


if __name__ == "__main__":
    main()
