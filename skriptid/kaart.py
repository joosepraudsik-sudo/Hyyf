"""Render the site suitability map and factor panels as PNG (valjund/).

Run: uv run python -I skriptid/kaart.py
"""
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
import numpy as np  # noqa: E402
import rasterio  # noqa: E402
from matplotlib.colors import LinearSegmentedColormap, ListedColormap  # noqa: E402
from matplotlib.patches import Patch  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
GRID = BASE / "andmed" / "testala_5458" / "ruudustik"
OUT = BASE / "valjund"

INK, MUTED, SURFACE = "#1f1f1f", "#6b6b6b", "#ffffff"
SUIT = LinearSegmentedColormap.from_list("kukeseen", ["#fbe3d3", "#f4a77f", "#eb6834", "#b8461b", "#6e2508"])
REGIME = {1: ("kuiv", "#cde2fb"), 2: ("värske", "#6da7ec"), 3: ("niiske", "#2a78d6"),
          4: ("märg", "#184f95"), 5: ("kuivendatud turvas", "#9c8fd0")}
EXTENT = (680, 690, 6450, 6460)  # km


def read(path, band=1):
    with rasterio.open(path) as d:
        return d.read(band), d.descriptions


def hillshade(dtm, az=315, alt=45):
    gy, gx = np.gradient(np.nan_to_num(dtm, nan=np.nanmean(dtm)), 10)
    slope = np.arctan(np.hypot(gx, gy) * 3)  # exaggerate relief in flat terrain
    aspect = np.arctan2(-gx, gy)
    az, alt = np.radians(az), np.radians(alt)
    return np.sin(alt) * np.cos(slope) + np.cos(alt) * np.sin(slope) * np.cos(az - aspect)


def style(ax):
    ax.set_xlabel("L-EST97 E, km", color=MUTED, fontsize=8)
    ax.set_ylabel("N, km", color=MUTED, fontsize=8)
    ax.tick_params(colors=MUTED, labelsize=7, length=2)
    for s in ax.spines.values():
        s.set_color("#d0d0d0")


def base(ax, hs):
    ax.imshow(hs, cmap="Greys_r", vmin=-0.2, vmax=1.1, extent=EXTENT, alpha=0.55)


def main():
    plt.rcParams.update({"font.family": "Segoe UI", "text.color": INK})
    suit, _ = read(OUT / "sobivus_5458.tif")
    regime, _ = read(OUT / "veereziim_5458.tif")
    dtm, _ = read(GRID / "dtm.tif")
    hs = hillshade(dtm)

    # main map
    fig, ax = plt.subplots(figsize=(9, 9.6), dpi=150, facecolor=SURFACE)
    base(ax, hs)
    im = ax.imshow(np.ma.masked_invalid(suit), cmap=SUIT, vmin=0, vmax=1, extent=EXTENT,
                   interpolation="nearest")
    style(ax)
    fig.suptitle("Kasvukoha sobivus – harilik kukeseen (mudel v0)", x=0.06, ha="left",
                 fontsize=14, fontweight="semibold")
    ax.set_title("Testala 5458, Põlvamaa · 10 m ruudustik · hall = metsaregistrita ala",
                 loc="left", color=MUTED, fontsize=9)
    cb = fig.colorbar(im, ax=ax, orientation="horizontal", fraction=0.035, pad=0.08)
    cb.set_label("sobivus (0 = sobimatu, 1 = optimaalne)", color=MUTED, fontsize=8)
    cb.outline.set_visible(False)
    cb.ax.tick_params(colors=MUTED, labelsize=7)
    fig.savefig(OUT / "sobivus_5458.png", bbox_inches="tight", facecolor=SURFACE)
    plt.close(fig)

    # factor panels + water regime
    with rasterio.open(OUT / "tegurid_5458.tif") as d:
        factors = [(d.descriptions[i], d.read(i + 1)) for i in range(d.count)]
    fig, axes = plt.subplots(2, 4, figsize=(16, 8.6), dpi=110, facecolor=SURFACE)
    for ax, (name, arr) in zip(axes.flat, factors):
        base(ax, hs)
        ax.imshow(np.ma.masked_invalid(arr), cmap=SUIT, vmin=0, vmax=1, extent=EXTENT,
                  interpolation="nearest")
        ax.set_title(f"{name} (mean {np.nanmean(arr):.2f})", loc="left", fontsize=10)
        style(ax)
    ax = axes.flat[len(factors)]
    base(ax, hs)
    cmap = ListedColormap([REGIME[k][1] for k in sorted(REGIME)])
    ax.imshow(np.ma.masked_equal(regime, 0), cmap=cmap, vmin=0.5, vmax=5.5, extent=EXTENT,
              interpolation="nearest")
    ax.set_title("veerežiimi klass", loc="left", fontsize=10)
    ax.legend(handles=[Patch(color=c, label=f"{k} {n}") for k, (n, c) in REGIME.items()],
              loc="lower left", fontsize=7, frameon=True, framealpha=0.9)
    style(ax)
    for ax in axes.flat[len(factors) + 1:]:
        ax.axis("off")
    fig.suptitle("Tegurite skoorid (0–1, sama värviskaala) ja veerežiim", x=0.02, ha="left",
                 fontsize=13, fontweight="semibold")
    fig.tight_layout()
    fig.savefig(OUT / "tegurid_5458.png", facecolor=SURFACE)
    plt.close(fig)
    print("valjund/sobivus_5458.png, valjund/tegurid_5458.png")


if __name__ == "__main__":
    main()
