"""Download nationwide input data into andmed/eesti (about 20 GB, resumable).

  metsaregister/lehed/<leht>.geojson   forest stands per 1:20 000 sheet (stands on a sheet edge are in both)
  metsaregister/eraldis_element/osa_NNNN.json   stand composition, whole layer in pages (list of properties)
  metsaregister/kl_*.json              classifiers
  korgus/<leht10k>_dtm_5m.tif          DTM 5 m per 1:10 000 sheet (1 m would be ~150 GB)
  korgus/<leht>_chm_*.tif              canopy height per 1:20 000 sheet: newest and newest summer (leaf-on)
  muld/                                soil map (lae_testala.lae_muld)

Height data is fetched only for sheets that have forest stands. Existing files are skipped,
so the script can be stopped and restarted.
Run: uv run python -I skriptid/lae_eesti.py [metsaregister|koosseis|korgus|koik]
"""
import json
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ala import leht_20k  # noqa: E402
from lae_testala import EESTI, GEO, MR, fetch, lae_muld, session  # noqa: E402

# L-EST97 extent of Estonia incl. islands, km (10 km steps)
E_KM = range(360, 750, 10)
N_KM = range(6370, 6640, 10)
LEHT = 1 << 14                  # eraldis_element page size
TOOLISI = 4                     # parallel downloads, keep it polite

MRD = EESTI / "metsaregister"
KORGUS = EESTI / "korgus"
LEHED_JSON = MRD / "lehed.json"  # sheet -> stand count


def korda(fn):
    """Retry a per-item download a few times so one network hiccup does not stop a long run."""
    def wrapped(*a):
        for k in range(5):
            try:
                return fn(*a)
            except Exception as e:  # noqa: BLE001
                if k == 4:
                    raise
                print(f"  viga ({e.__class__.__name__}: {e}), proovin uuesti")
                time.sleep(10 * (k + 1))
    return wrapped


def sheets():
    for n in N_KM:
        for e in E_KM:
            yield leht_20k(e, n), (e * 1000, n * 1000, e * 1000 + 10000, n * 1000 + 10000)


@korda
def lae_lehe_eraldised(item):
    leht, bbox = item
    path = MRD / "lehed" / f"{leht}.geojson"
    if not path.exists():
        tmp = path.with_suffix(".part")
        with session.get(f"{MR}&typeName=metsaregister:eraldis&bbox={','.join(map(str, bbox))}",
                         timeout=900, stream=True) as r:
            r.raise_for_status()
            with open(tmp, "wb") as f:
                for chunk in r.iter_content(1 << 20):
                    f.write(chunk)
        n = len(json.loads(tmp.read_bytes())["features"])
        if n:
            tmp.replace(path)
        else:
            tmp.unlink()     # sea or outside Estonia: remember the count only
        return leht, n
    return leht, len(json.loads(path.read_bytes())["features"])


def lae_metsaregister():
    (MRD / "lehed").mkdir(parents=True, exist_ok=True)
    counts = json.loads(LEHED_JSON.read_text()) if LEHED_JSON.exists() else {}
    todo = [s for s in sheets() if s[0] not in counts]
    print(f"  lehti kokku {len(counts) + len(todo)}, laadida {len(todo)}")
    with ThreadPoolExecutor(TOOLISI) as ex:
        for i, (leht, n) in enumerate(ex.map(lae_lehe_eraldised, todo), 1):
            counts[leht] = n
            if n:
                print(f"  {leht}: {n} eraldist ({i}/{len(todo)})")
            if i % 20 == 0:
                LEHED_JSON.write_text(json.dumps(counts, sort_keys=True))
    LEHED_JSON.write_text(json.dumps(counts, sort_keys=True))
    metsaga = sum(1 for n in counts.values() if n)
    print(f"  metsaga lehti {metsaga}, eraldisi lehtedel kokku {sum(counts.values())} (servadel topelt)")
    for kl in ["kl_kasvukoht", "kl_puuliik", "kl_rinne", "kl_omandivorm"]:
        fetch(f"{MR}&typeName=metsaregister:{kl}", MRD / f"{kl}.json")


def lae_koosseis():
    out = MRD / "eraldis_element"
    out.mkdir(parents=True, exist_ok=True)
    wfs2 = MR.replace("version=1.0.0", "version=2.0.0")
    hits = session.get(f"{wfs2}&typeNames=metsaregister:eraldis_element&resultType=hits", timeout=300).text
    total = int(re.search(r'numberMatched="(\d+)"', hits).group(1))
    pages = range((total + LEHT - 1) // LEHT)
    print(f"  koosseisu ridu {total}, lehekulgi {len(pages)}")

    @korda
    def page(i):
        path = out / f"osa_{i:04d}.json"
        if path.exists():
            return 0
        r = session.get(f"{wfs2}&typeNames=metsaregister:eraldis_element&sortBy=sys_id"
                        f"&count={LEHT}&startIndex={i * LEHT}", timeout=900)
        r.raise_for_status()
        rows = [f["properties"] for f in r.json()["features"]]
        path.with_suffix(".part").write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        path.with_suffix(".part").replace(path)
        return len(rows)

    with ThreadPoolExecutor(TOOLISI) as ex:
        for i, n in zip(pages, ex.map(page, pages)):
            if n:
                print(f"  osa {i + 1}/{len(pages)}: {n} rida")


def failid(sheet, kind):
    html = session.get(f"{GEO}&kaardiruut={sheet}&andmetyyp={kind}", timeout=120).text
    return {name: "https://geoportaal.maaruum.ee/" + href.replace("&amp;", "&")
            for href, name in re.findall(r'href="(index\.php\?[^"]+?f=([^&"]+)[^"]*)"', html)}


def chm_valik(names):
    """Newest CHM and newest summer CHM (same file if the newest is from summer)."""
    def year(n):
        m = re.search(r"(\d{4})\.tif$", n)
        return int(m.group(1)) if m else 0
    names = sorted((n for n in names if n.endswith(".tif")), key=year)
    if not names:
        return []
    summer = [n for n in names if "suvi" in n]
    return sorted({names[-1], *(summer[-1:])})


@korda
def lae_lehe_korgus(leht):
    msg = []
    for q in "1234":
        for name, url in failid(leht + q, "dem_5m_geotiff").items():
            if name.endswith("_dtm_5m.tif"):
                fetch(url, KORGUS / name)
    chm = failid(leht, "chm_geotiff")
    valik = chm_valik(chm)
    for name in valik:
        fetch(chm[name], KORGUS / name)
    if not valik:
        msg.append("CHM puudub")
    return leht, msg


def lae_korgus():
    if not LEHED_JSON.exists():
        sys.exit("Enne korgust lae metsaregister (lehtede nimekiri).")
    lehed = sorted(k for k, n in json.loads(LEHED_JSON.read_text()).items() if n)
    print(f"  metsaga lehti {len(lehed)}: DTM 5 m (4 veerandit) + CHM")
    with ThreadPoolExecutor(TOOLISI) as ex:
        for i, (leht, msg) in enumerate(ex.map(lae_lehe_korgus, lehed), 1):
            print(f"  {leht} valmis ({i}/{len(lehed)}){' - ' + ', '.join(msg) if msg else ''}")


def main():
    mis = sys.argv[1] if len(sys.argv) > 1 else "koik"
    if mis in ("metsaregister", "koik"):
        print("1/4 Metsaregister lehtede kaupa")
        lae_metsaregister()
    if mis in ("koosseis", "koik"):
        print("2/4 Puistu koosseis")
        lae_koosseis()
    if mis in ("korgus", "koik"):
        print("3/4 Korgusandmed (DTM 5 m, CHM)")
        lae_korgus()
    if mis == "koik":
        print("4/4 Mullakaart")
        lae_muld()
    print(f"\nValmis. Andmed: {EESTI}")


if __name__ == "__main__":
    main()
