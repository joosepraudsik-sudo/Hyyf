"""The user's own mushroom spots for the page's "Hüüf" switch.

Reads the spots table (columns Liik, Koordinaadid "lat, lon", Hinnang, Saladus) from a CSV file or
the Google Sheets CSV export, keeps only mushrooms (secret ones too, the user's choice) and writes
leht/andmed/eesti/kohad.json.gz (+ .js copy for file://). The table's address stays out of git:
it is kept in andmed/leiud/kohad_url.txt (gitignored), the last download in andmed/leiud/kohad.csv.

    uv run python -I skriptid/hyyf_kohad.py [--url https://docs.google.com/spreadsheets/d/<id>/edit]
"""
import argparse
import base64
import csv
import gzip
import io
import json
import re
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LEIUD = ROOT / "andmed" / "leiud"
URL_FAIL = LEIUD / "kohad_url.txt"
CSV_FAIL = LEIUD / "kohad.csv"
OUT = ROOT / "leht" / "andmed" / "eesti"

# mushrooms not named "...seen"; everything else (berries, fish, ...) is left out
SEENED = {"puravik", "sirmik", "riisikas", "pilvik", "lehtrik", "mamp", "kitsemamp", "männiriisikas",
          "kuuseriisikas", "kivipuravik", "punajalg", "kitsemamp", "kollariisikas", "vöödik", "koorik"}


def on_seen(liik):
    n = liik.strip().lower()
    return "seen" in n or n in SEENED or n.endswith("puravik") or n.endswith("riisikas") or n.endswith("pilvik")


def csv_tekst(url):
    m = re.search(r"/spreadsheets/d/([\w-]+)", url)
    if m:
        gid = re.search(r"gid=(\d+)", url)
        url = f"https://docs.google.com/spreadsheets/d/{m.group(1)}/export?format=csv&gid={gid.group(1) if gid else 0}"
    with urllib.request.urlopen(url, timeout=60) as r:
        return r.read().decode("utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", help="Google Sheets link or CSV address (remembered in andmed/leiud/kohad_url.txt)")
    ap.add_argument("--fail", type=Path, help="read this CSV file instead of downloading")
    a = ap.parse_args()
    LEIUD.mkdir(parents=True, exist_ok=True)
    if a.fail:
        tekst = a.fail.read_text("utf-8-sig")
    else:
        if a.url:
            URL_FAIL.write_text(a.url.strip(), "utf-8")
        tekst = csv_tekst(URL_FAIL.read_text("utf-8").strip())
        CSV_FAIL.write_text(tekst, "utf-8")

    kohad, valja = [], {}
    for r in csv.DictReader(io.StringIO(tekst)):
        liik = (r.get("Liik") or "").strip()
        nr = re.findall(r"-?\d+(?:\.\d+)?", r.get("Koordinaadid") or "")
        if not liik or len(nr) < 2:
            continue
        if not on_seen(liik):
            valja[liik] = valja.get(liik, 0) + 1
            continue
        kohad.append({"liik": liik, "lat": round(float(nr[0]), 5), "lon": round(float(nr[1]), 5),
                      "hinnang": (r.get("Hinnang") or "").strip()})

    OUT.mkdir(parents=True, exist_ok=True)
    gz = OUT / "kohad.json.gz"
    gz.write_bytes(gzip.compress(json.dumps(kohad, ensure_ascii=False).encode("utf-8"), mtime=0))
    (OUT / "kohad.json.js").write_text(
        f'HYYF_FAIL("kohad.json.gz","{base64.b64encode(gz.read_bytes()).decode("ascii")}");\n', "ascii")
    print(f"seenekohti {len(kohad)}; välja jäetud: " + ", ".join(f"{k} {v}" for k, v in valja.items()))


if __name__ == "__main__":
    main()
