"""Combine site suitability with the fruiting index for given dates and render a heat map.

Display follows the agreed scale: neighbourhood mean over forest cells within ~100 m,
aggregated to 50 m cells (shown where at least a quarter of the cell is forest).

Run: uv run python -I skriptid/soojuskaart.py 2023-08-15 2025-09-13
"""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import pandas as pd  # noqa: E402
import rasterio  # noqa: E402
from pyproj import Transformer  # noqa: E402
from scipy.signal import fftconvolve  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
from kaart import EXTENT, SUIT, SURFACE, MUTED, base, hillshade, style  # noqa: E402
from lae_testala import ILMAPUNKTID  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
GRID = BASE / "andmed" / "testala_5458" / "ruudustik"
OUT = BASE / "valjund"
RES = 10
RADIUS_M = 100
BLOCK = 5            # 5 x 10 m = 50 m display cells
MIN_FOREST = 0.25


def read(path):
    with rasterio.open(path) as d:
        return d.read(1), d.transform


def nearest_point(transform, shape):
    to3301 = Transformer.from_crs("EPSG:4326", "EPSG:3301", always_xy=True)
    names = list(ILMAPUNKTID)
    xy = np.array([to3301.transform(lon, lat) for lat, lon in ILMAPUNKTID.values()])
    x = transform.c + (np.arange(shape[1]) + 0.5) * transform.a
    y = transform.f + (np.arange(shape[0]) + 0.5) * transform.e
    d2 = (x[None, None, :] - xy[:, 0, None, None]) ** 2 + (y[None, :, None] - xy[:, 1, None, None]) ** 2
    return names, np.argmin(d2, axis=0)


def neighbourhood(value, forest):
    """Mean of value over forest cells within RADIUS_M, then 50 m block means."""
    r = RADIUS_M // RES
    yy, xx = np.mgrid[-r:r + 1, -r:r + 1]
    disk = (xx ** 2 + yy ** 2 <= r ** 2).astype(float)
    f = forest.astype(float)
    num = fftconvolve(np.where(forest, value, 0), disk, mode="same")
    den = fftconvolve(f, disk, mode="same")
    smooth = np.where(den > 0.5, num / np.maximum(den, 1e-9), np.nan)
    h, w = (s // BLOCK for s in value.shape)
    blocks = lambda a: a[:h * BLOCK, :w * BLOCK].reshape(h, BLOCK, w, BLOCK)
    share = blocks(f).mean(axis=(1, 3))
    with np.errstate(invalid="ignore"):
        cells = blocks(np.where(forest, smooth, 0)).sum(axis=(1, 3))
        mean = cells / blocks(forest & ~np.isnan(smooth)).sum(axis=(1, 3))
    return np.where(share >= MIN_FOREST, mean, np.nan)


def main():
    dates = [pd.Timestamp(d) for d in (sys.argv[1:] or ["2023-08-15", "2025-09-13"])]
    suit, transform = read(OUT / "sobivus_5458.tif")
    regime, _ = read(OUT / "veereziim_5458.tif")
    dtm, _ = read(GRID / "dtm.tif")
    forest = ~np.isnan(suit)
    names, point_idx = nearest_point(transform, suit.shape)
    fr = pd.read_csv(OUT / "viljumine_5458.csv", parse_dates=["kuupaev"])

    plt.rcParams.update({"font.family": "Segoe UI"})
    fig, axes = plt.subplots(1, len(dates), figsize=(7.2 * len(dates), 7.9), dpi=130,
                             facecolor=SURFACE, layout="constrained", squeeze=False)
    hs = hillshade(dtm)
    for ax, date in zip(axes[0], dates):
        day = fr[fr["kuupaev"] == date].set_index(["punkt", "klass"])["indeks"]
        lut = np.zeros((len(names), 6))
        for (p, k), v in day.items():
            lut[names.index(p), k] = v
        index = lut[point_idx, regime]
        shown = neighbourhood(np.where(forest, suit * index, 0), forest)
        base(ax, hs)
        im = ax.imshow(np.ma.masked_invalid(shown), cmap=SUIT, vmin=0, vmax=1, extent=EXTENT,
                       interpolation="nearest")
        cls = day.groupby("klass").mean()
        ax.set_title(f"{date:%d.%m.%Y}", loc="left", fontsize=13, fontweight="semibold")
        ax.set_title("viljumisindeks klassiti: " + "  ".join(f"{k}: {v:.2f}" for k, v in cls.items()),
                     loc="right", fontsize=8, color=MUTED)
        style(ax)
        print(f"{date:%Y-%m-%d}: 50 m ruute {np.isfinite(shown).sum()}, "
              f"keskmine {np.nanmean(shown):.2f}, >= 0.5: {(shown >= 0.5).sum()}")
    cb = fig.colorbar(im, ax=axes[0].tolist(), orientation="horizontal", fraction=0.04, shrink=0.5)
    cb.set_label("kukeseene leidmise hinnang = sobivus × viljumisindeks (ümbrus 100 m, 50 m ruudud)",
                 color=MUTED, fontsize=8)
    cb.outline.set_visible(False)
    cb.ax.tick_params(colors=MUTED, labelsize=7)
    fig.suptitle("Kukeseente soojuskaart – sama mets, erinev ilm", x=0.02, ha="left",
                 fontsize=15, fontweight="semibold")
    fig.savefig(OUT / "soojuskaart_5458.png", facecolor=SURFACE)
    print("valjund/soojuskaart_5458.png")


if __name__ == "__main__":
    main()
