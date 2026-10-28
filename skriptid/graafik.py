"""Season charts of the fruiting index per water regime class (valjund/hooajad_5458.png).

Run: uv run python -I skriptid/graafik.py [punkt]
"""
import sys
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.dates as mdates  # noqa: E402
import matplotlib.pyplot as plt  # noqa: E402
import pandas as pd  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402
from viljumine import load_weather  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
OUT = BASE / "valjund"
INK, MUTED, GRID, SURFACE = "#1f1f1f", "#6b6b6b", "#e6e6e6", "#ffffff"
# categorical slots 1-5 of the reference palette, fixed order
COLORS = {1: "#2a78d6", 2: "#eb6834", 3: "#1baf7a", 4: "#eda100", 5: "#e87ba4"}


def style(ax):
    ax.tick_params(colors=MUTED, labelsize=7, length=0)
    ax.grid(axis="y", color=GRID, linewidth=0.6)
    for s in ax.spines.values():
        s.set_visible(False)


def main():
    point = sys.argv[1] if len(sys.argv) > 1 else "keskel"
    plt.rcParams.update({"font.family": "Segoe UI", "text.color": INK})
    d = pd.read_csv(OUT / "viljumine_5458.csv", parse_dates=["kuupaev"])
    d = d[d["punkt"] == point]
    wx = load_weather(point)
    years = sorted(d["kuupaev"].dt.year.unique())

    fig = plt.figure(figsize=(12, 3.3 * len(years)), dpi=120, facecolor=SURFACE,
                     layout="constrained")
    for i, (year, sub) in enumerate(zip(years, fig.subfigures(len(years), 1))):
        start, end = pd.Timestamp(f"{year}-05-01"), pd.Timestamp(f"{year}-10-31")
        ax_p, ax_i = sub.subplots(2, 1, sharex=True, height_ratios=[1, 2.6])
        w = wx.loc[start:end]
        ax_p.bar(w.index, w["p"], width=0.8, color="#86b6ef")
        ax_p.set_ylim(0, 45)
        ax_p.set_ylabel("sademed\nmm/päev", color=MUTED, fontsize=7)
        ax_p.set_title(f"{year}   (mai–okt sademeid {w['p'].sum():.0f} mm)", loc="left",
                       fontsize=11, fontweight="semibold")
        plt.setp(ax_p.get_xticklabels(), visible=False)
        style(ax_p)
        for regime, color in COLORS.items():
            g = d[(d["klass"] == regime) & d["kuupaev"].between(start, end)]
            ax_i.plot(g["kuupaev"], g["indeks"], color=color, linewidth=2,
                      label=f"{regime} {P.VEEREZIIM[regime]['nimi']}")
        ax_i.set_ylim(0, 1)
        ax_i.set_xlim(start, end)
        ax_i.set_ylabel("viljumisindeks", color=MUTED, fontsize=7)
        ax_i.xaxis.set_major_locator(mdates.MonthLocator())
        ax_i.xaxis.set_major_formatter(mdates.DateFormatter("%d.%m"))
        style(ax_i)
        if i == 0:
            ax_i.legend(loc="upper left", ncol=5, fontsize=8, frameon=False,
                        bbox_to_anchor=(0, 1.02))
    fig.suptitle(f"Kukeseene viljumisindeks veerežiimi klassi järgi – punkt '{point}', ERA5 ilm",
                 x=0.02, ha="left", fontsize=13, fontweight="semibold")
    fig.savefig(OUT / "hooajad_5458.png", bbox_inches="tight", facecolor=SURFACE)
    print("valjund/hooajad_5458.png")


if __name__ == "__main__":
    main()
