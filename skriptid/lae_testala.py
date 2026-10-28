"""Download test area data (map sheet 5458, L-EST97 E 680-690 km, N 6450-6460 km).

Python port of lae_testala.ps1. Skips files that already exist.
Run: uv run python skriptid/lae_testala.py
"""
import json
import re
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent / "andmed" / "testala_5458"
SHEET = "5458"
BBOX = "680000,6450000,690000,6460000"

GEO = "https://geoportaal.maaruum.ee/index.php?lang_id=2&plugin_act=otsing&page_id=664"
MR = ("https://gsavalik.envir.ee/geoserver/metsaregister/ows?service=WFS&version=1.0.0"
      "&request=GetFeature&outputFormat=application/json&srsName=EPSG:3301")
MULD = ("https://teenus.maaamet.ee/ows/mullakaart?service=WFS&version=1.0.0"
        f"&request=GetFeature&bbox={BBOX}")

# Weather points (lat, lon): sheet corners slightly inset + centre
ILMAPUNKTID = {
    "edel": (58.165, 27.075), "loe": (58.235, 27.080), "keskel": (58.197, 27.147),
    "kirre": (58.230, 27.220), "kagu": (58.160, 27.215),
}

session = requests.Session()
session.headers["User-Agent"] = "siil-korilase-kompass/0.1"


def fetch(url, path: Path, **kw):
    if path.exists() and path.stat().st_size > 0:
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


def geoportaal(sheet, kind, patterns):
    html = session.get(f"{GEO}&kaardiruut={sheet}&andmetyyp={kind}", timeout=120).text
    found = 0
    for href, name in re.findall(r'href="(index\.php\?[^"]+?f=([^&"]+)[^"]*)"', html):
        if any(re.fullmatch(p, name) for p in patterns):
            fetch("https://geoportaal.maaruum.ee/" + href.replace("&amp;", "&"),
                  ROOT / "korgus" / name)
            found += 1
    if not found:
        print(f"  HOIATUS: {kind} {sheet} - sobivaid faile ei leitud")


def main():
    print("1/4 Korgusandmed (DTM 1 m, vorastiku korgus CHM)")
    for q in range(1, 5):
        geoportaal(f"{SHEET}{q}", "dem_1m_geotiff", [r".*_dtm_1m\.tif"])
    geoportaal(SHEET, "chm_geotiff", [r".*kevad_2023\.tif", r".*suvi_2021\.tif"])

    print("2/4 Metsaregister")
    md = ROOT / "metsaregister"
    eraldis = md / "eraldis.geojson"
    fetch(f"{MR}&typeName=metsaregister:eraldis&bbox={BBOX}", eraldis)

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

    print("3/4 Mullakaart")
    # WFS layer has geometry only, no attributes -> use the national file download
    # (562 MB, all of Estonia; reused later for the full country).
    eesti = ROOT.parent / "eesti" / "muld"
    fetch("https://geoportaal.maaruum.ee/docs/muld/Mullakaart_GDB.zip", eesti / "Mullakaart_GDB.zip")
    fetch("https://geoportaal.maaruum.ee/docs/muld/mullalegend.pdf", eesti / "mullalegend.pdf")

    print("4/4 Ilm (ERA5-Land 2023-2026, Open-Meteo, ainult arenduseks)")
    daily = ("temperature_2m_mean,temperature_2m_min,temperature_2m_max,precipitation_sum,"
             "et0_fao_evapotranspiration,soil_moisture_0_to_7cm_mean,"
             "soil_moisture_7_to_28cm_mean,soil_temperature_0_to_7cm_mean")
    # Open-Meteo has no precipitation / ET0 for era5_land -> take those from ERA5 (~31 km)
    daily_era5 = "precipitation_sum,rain_sum,snowfall_sum,et0_fao_evapotranspiration"
    for name, (lat, lon) in ILMAPUNKTID.items():
        for model, variables in [("era5_land", daily), ("era5", daily_era5)]:
            url = ("https://archive-api.open-meteo.com/v1/archive"
                   f"?latitude={lat}&longitude={lon}&start_date=2023-01-01&end_date=2026-10-20"
                   f"&daily={variables}&models={model}&timezone=Europe%2FTallinn")
            fetch(url, ROOT / "ilm" / f"{model.replace('_', '')}_{name}.json")
            time.sleep(1)

    print(f"\nValmis. Andmed: {ROOT}")


if __name__ == "__main__":
    main()
