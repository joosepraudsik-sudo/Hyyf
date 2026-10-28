"""Dynamic moisture and fruiting model for harilik kukeseen.

For every weather point and water regime class: daily soil water bucket, season readiness,
initiation after wetting, thermal-time delay to mature fruit bodies, and their survival.
Output: valjund/viljumine_5458.csv (long format, one row per date x point x class).

Run: uv run python -I skriptid/viljumine.py
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import parameetrid as P  # noqa: E402
from lae_testala import ILMAPUNKTID  # noqa: E402

BASE = Path(__file__).resolve().parent.parent
WX = BASE / "andmed" / "testala_5458" / "ilm"
OUT = BASE / "valjund"
POINTS = list(ILMAPUNKTID)


def interp(x, table):
    xs, ys = zip(*table)
    return np.interp(x, xs, ys)


def load_weather(point):
    """Daily weather: temperature from ERA5-Land, precipitation and ET0 from ERA5."""
    def daily(name):
        d = pd.DataFrame(json.loads((WX / f"{name}_{point}.json").read_text("utf-8"))["daily"])
        return d.set_index(pd.to_datetime(d.pop("time")))
    land, era5 = daily("era5land"), daily("era5")
    wx = pd.DataFrame({
        "t": land["temperature_2m_mean"],
        "tmin": land["temperature_2m_min"],
        "tmuld": land["soil_temperature_0_to_7cm_mean"],
        "p": era5["precipitation_sum"],
        "et0": era5["et0_fao_evapotranspiration"],
    })
    return wx.dropna()


def water_balance(wx, regime):
    r = P.VEEREZIIM[regime]
    kp, floor = r["kp"], r["pohi"] * r["kp"]
    s, snow = 0.8 * kp, 0.0
    w = np.empty(len(wx))
    for i, (t, p, et0) in enumerate(zip(wx["t"].to_numpy(), wx["p"].to_numpy(), wx["et0"].to_numpy())):
        p_net = p - min(P.VAHETUS * p, P.VAHETUS_MAX)
        if t < 0:
            snow += p_net
            p_net = 0.0
        elif snow > 0:
            melt = min(snow, 3.0 * t)
            snow -= melt
            p_net += melt
        aet = P.KC * et0 * min(1.0, s / kp / P.KC_STRESS)
        s = s + p_net - aet
        if s < floor:
            s += r["tous"] * (floor - s)
        s = min(max(s, 0.0), kp)
        w[i] = s / kp
    return w


def simulate(wx, regime):
    r = P.VEEREZIIM[regime]
    t, tmin = wx["t"].to_numpy(), wx["tmin"].to_numpy()
    w = water_balance(wx, regime)
    moist = interp(w, P.NIISKUS + [(1.0, r["marg"])])

    # season: degree days since 1 Jan and earlier moisture
    gdd = pd.Series(np.maximum(t - P.KRAADIPAEV_ALUS, 0), index=wx.index)
    gdd = gdd.groupby(wx.index.year).cumsum().to_numpy()
    back_from, back_to = P.HOOAEG_NIISKUS_AKEN
    w_past = pd.Series(w).rolling(back_from - back_to, min_periods=1).mean().shift(back_to).bfill()
    season = interp(gdd, P.HOOAEG_KP) * interp(w_past.to_numpy(), P.HOOAEG_NIISKUS)

    # initiation: wetting pulse or sustained moisture
    dw = w - np.concatenate([np.full(3, w[0]), w[:-3]])
    pulse = np.clip(dw / P.TOUKE_DW, 0, 1)
    soil_t = wx["tmuld"].rolling(P.MULLA_TEMP_AKEN, min_periods=1).mean().to_numpy()
    temp = interp(t, P.ALGUS_TEMP) * interp(soil_t, P.MULLA_TEMP)
    init = np.maximum(pulse, P.TOUKE_PUSIV) * moist * temp * season

    # thermal-time delay to mature fruit bodies
    ct = np.cumsum(np.maximum(t - P.VIIVITUS_ALUS, 0))
    mature_day = np.searchsorted(ct, ct + P.VIIVITUS_KP)
    arrivals = np.zeros(len(t))
    ok = (mature_day < len(t)) & (mature_day - np.arange(len(t)) <= P.VIIVITUS_MAX)
    np.add.at(arrivals, mature_day[ok], init[ok])

    # standing crop of fruit bodies
    surv = np.where(w < 0.2, P.ELU_POUD, P.ELU_PAEV)
    surv = np.where(t < P.JAHE_PIIR, np.minimum(surv, P.ELU_JAHE), surv)
    surv = surv * np.where(tmin < P.KULM_PIIR, P.ELU_KULM, 1.0)
    crop = np.empty(len(t))
    b = 0.0
    for i in range(len(t)):
        b = b * surv[i] + arrivals[i]
        crop[i] = b
    return pd.DataFrame({
        "w": w, "niiskus": moist, "hooaeg": season, "temperatuur": temp, "algus": init, "saak": crop,
        "indeks": np.minimum(1, crop / P.INDEKS_SKAALA),
    }, index=wx.index)


def main():
    OUT.mkdir(exist_ok=True)
    rows = []
    for point in POINTS:
        wx = load_weather(point)
        for regime in P.VEEREZIIM:
            d = simulate(wx, regime)
            d.insert(0, "klass", regime)
            d.insert(0, "punkt", point)
            rows.append(d)
    out = pd.concat(rows).rename_axis("kuupaev").reset_index()
    out.to_csv(float_format="%.4f", path_or_buf=OUT / "viljumine_5458.csv", index=False)
    print(f"valjund/viljumine_5458.csv: {len(out)} rida")

    c = out[out["punkt"] == "keskel"]
    summer = c[c["kuupaev"].dt.month.between(6, 10)]
    print("\nKeskpunkt, juuni-oktoober: keskmine / maksimum viljumisindeks ja tippkuupaev")
    for (year, regime), g in summer.groupby([summer["kuupaev"].dt.year, "klass"]):
        top = g.loc[g["indeks"].idxmax()]
        print(f"  {year} klass {regime} {P.VEEREZIIM[regime]['nimi']:18s} "
              f"kesk {g['indeks'].mean():.2f}  max {top['indeks']:.2f}  {top['kuupaev']:%d.%m}  "
              f"w kesk {g['w'].mean():.2f}")


if __name__ == "__main__":
    main()
