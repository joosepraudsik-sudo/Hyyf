"""Download input data for an area (default: test sheet 5458, L-EST97 E 680-690 km, N 6450-6460 km).

Python port of lae_testala.ps1, split into functions so the same downloads work for any area
(see ala.py). Skips files that already exist, except the weather forecast.
Run: uv run python -I skriptid/lae_testala.py
"""
import json
import re
import sys
import time
from datetime import date
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ala import BASE, TESTALA, lehed_10k, lehed_20k  # noqa: E402

GEO = "https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&page_id=664"
MR = ("https://gsavalik.envir.ee/geoserver/metsaregister/ows?service=WFS&version=1.0.0"
      "&request=GetFeature&outputFormat=application/json&srsName=EPSG:3301")
EESTI = BASE / "andmed" / "eesti"

# Weather points of the test sheet (lat, lon): sheet corners slightly inset + centre
ILMAPUNKTID = {
    "edel": (58.165, 27.075), "loe": (58.235, 27.080), "keskel": (58.197, 27.147),
    "kirre": (58.230, 27.220), "kagu": (58.160, 27.215),
}
# Test sheet CHM files used so far (other years exist for some sheets)
TESTALA_CHM = [r".*kevad_2023\.tif", r".*suvi_2021\.tif"]

session = requests.Session()
session.headers["User-Agent"] = "siil-korilase-kompass/0.1"


def fetch(url, path: Path, refresh=False, **kw):
    if not refresh and path.exists() and path.stat().st_size > 0:
        print(f"  olemas: {path.name}")
        return
    print(f"  laen: {path.name}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    with session.get(url, stream=True, timeout=600, **kw) as r:
        r.raise_for_status()
        with open(tmp, "wb") as f:
            for chunk in r.iter_content(1 << 20):
                f.write(chunk)
    tmp.replace(path)


def geoportaal(sheet, kind, patterns, target: Path):
    html = session.get(f"{GEO}&kaardiruut={sheet}&andmetyyp={kind}", timeout=120).text
    found = 0
    for href, name in re.findall(r'href="(index\.php\?[^"]+?f=([^&"]+)[^"]*)"', html):
        if any(re.fullmatch(p, name) for p in patterns):
            fetch("https://geoportaal.maaruum.ee/" + href.replace("&amp;", "&"), target / name)
            found += 1
    if not found:
        print(f"  HOIATUS: {kind} {sheet} - sobivaid faile ei leitud")


def lae_korgus(ala, chm_mustrid=(r".*chm.*\.tif",)):
    """DTM 1 m per 1:10 000 sheet and canopy height (CHM) per 1:20 000 sheet."""
    for sheet in lehed_10k(ala):
        geoportaal(sheet, "dem_1m_geotiff", [r".*_dtm_1m\.tif"], ala.dir / "korgus")
    for sheet in lehed_20k(ala):
        geoportaal(sheet, "chm_geotiff", list(chm_mustrid), ala.dir / "korgus")


def lae_metsaregister(ala):
    md = ala.dir / "metsaregister"
    eraldis = md / "eraldis.geojson"
    fetch(f"{MR}&typeName=metsaregister:eraldis&bbox={','.join(map(str, ala.bbox))}", eraldis)

    el_path = md / "eraldis_element.json"
    if not el_path.exists():
        ids = [f["properties"]["id"] for f in json.loads(eraldis.read_bytes())["features"]]
        print(f"  eraldisi: {len(ids)}, laen puistu koosseisu")
        rows = []
        for i in range(0, len(ids), 200):
            chunk = ",".join(str(x) for x in ids[i:i + 200])
            r = session.get(f"{MR}&typeName=metsaregister:eraldis_element",
                            params={"CQL_FILTER": f"eraldis_id IN ({chunk})"}, timeout=300)
            r.raise_for_status()
            rows += [f["properties"] for f in r.json()["features"]]
        el_path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        print(f"  koosseisu ridu: {len(rows)}")
    for kl in ["kl_kasvukoht", "kl_puuliik", "kl_rinne"]:
        fetch(f"{MR}&typeName=metsaregister:{kl}", md / f"{kl}.json")


def lae_muld():
    # WFS layer has geometry only, no attributes -> use the national file download (562 MB)
    fetch("https://geoportaal.maaruum.ee/docs/muld/Mullakaart_GDB.zip", EESTI / "muld" / "Mullakaart_GDB.zip")
    fetch("https://geoportaal.maaruum.ee/docs/muld/mullalegend.pdf", EESTI / "muld" / "mullalegend.pdf")


def lae_ilm(target: Path, punktid: dict, algus="2023-01-01", lopp="2026-10-20", prognoos_paevi=10):
    """ERA5-Land temperature + ERA5 precipitation/ET0 (Open-Meteo archive, development only),
    then the last 14 days and a forecast (default 10 days) from the forecast API (always refreshed)."""
    daily = ("temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,"
             "et0_fao_evapotranspiration,soil_moisture_0_to_7cm_mean,"
             "soil_moisture_7_to_28cm_mean,soil_temperature_0_to_7cm_mean")
    # Open-Meteo has no precipitation / ET0 for era5_land -> take those from ERA5 (~31 km)
    daily_era5 = "precipitation_sum,rain_sum,snowfall_sum,et0_fao_evapotranspiration"
    for name, (lat, lon) in punktid.items():
        for model, variables in [("era5_land", daily), ("era5", daily_era5)]:
            url = ("https://archive-api.open-meteo.com/v1/archive"
                   f"?latitude={lat}&longitude={lon}&start_date={algus}&end_date={lopp}"
                   f"&daily={variables}&models={model}&timezone=Europe%2FTallinn")
            fetch(url, target / f"{model.replace('_', '')}_{name}.json")
            time.sleep(1)
    print(f"   + viimased 14 paeva ja {prognoos_paevi} paeva prognoos (Open-Meteo forecast)")
    for name, (lat, lon) in punktid.items():
        url = ("https://api.open-meteo.com/v1/forecast"
               f"?latitude={lat}&longitude={lon}&past_days=14&forecast_days={prognoos_paevi + 1}"
               "&daily=temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,"
               "et0_fao_evapotranspiration&hourly=soil_temperature_6cm&timezone=Europe%2FTallinn")
        fetch(url, target / f"prognoos_{name}.json", refresh=True)
        time.sleep(1)


def main():
    print("1/4 Korgusandmed (DTM 1 m, vorastiku korgus CHM)")
    lae_korgus(TESTALA, TESTALA_CHM)
    print("2/4 Metsaregister")
    lae_metsaregister(TESTALA)
    print("3/4 Mullakaart")
    lae_muld()
    print("4/4 Ilm (ERA5-Land 2023-2026, Open-Meteo, ainult arenduseks)")
    lae_ilm(TESTALA.dir / "ilm", ILMAPUNKTID)
    print(f"\nValmis. Andmed: {TESTALA.dir}")


if __name__ == "__main__":
    main()
