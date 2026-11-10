"""Publish data to the orphan branches of the GitHub repo, always as one commit (force push), so the
repo does not grow with every update.

  andmed  static map data, leht/andmed/eesti/*.gz without the daily weather files (kaart/, info/,
          ylevaade.bin.gz, indeks.json.gz, kohad.json.gz). Run on your own computer after
          eksport_eesti.py (1-2 times a year) and hyyf_kohad.py. The daily workflow checks it out
          into leht/andmed/eesti.
  ilm     weather cache that `ilmavork.py lae` / `viljumine` and `eksport_eesti.py --ainult-ilm`
          need: andmed/eesti/ilm/{punktid,kliima,prognoos}.json and era5_*, era5land_*,
          prognoos_* per node (~36 MB). The first push from your computer, then the workflow
          updates it every morning.

Only .gz files / the listed weather files go in, never .js copies. The working tree and the current
branch are not touched: the commit is built with a separate index in the repo's own object store.

Run: uv run python -I skriptid/avalda_andmed.py [andmed|ilm] [--kuiv]
"""
import argparse
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path

BASE = Path(__file__).resolve().parent.parent
EESTI = BASE / "leht" / "andmed" / "eesti"
ILM = BASE / "andmed" / "eesti" / "ilm"
ILMA_FAILID = ("ilm.json.gz", "ilm.bin.gz")       # daily, written by the workflow
MAX_FAIL = 25 * 1024 * 1024                         # Cloudflare Pages: 25 MiB per file


def andmed_failid():
    files = [f for f in EESTI.rglob("*.gz") if f.parent != EESTI or f.name not in ILMA_FAILID]
    need = [EESTI / "indeks.json.gz", EESTI / "ylevaade.bin.gz", EESTI / "kohad.json.gz"]
    missing = [f.name for f in need if not f.exists()]
    if missing or not any((EESTI / "kaart").glob("*.gz")):
        raise SystemExit(f"Puudu: {missing or 'kaart/'} - käivita enne eksport_eesti.py (ja hyyf_kohad.py)")
    return EESTI, files


def ilm_failid():
    need = [ILM / "punktid.json", ILM / "kliima.json"]
    missing = [f.name for f in need if not f.exists()]
    if missing:
        raise SystemExit(f"Puudu: {missing}")
    files = need + [f for pat in ("era5_*.json", "era5land_*.json", "prognoos_*.json") for f in ILM.glob(pat)]
    if (ILM / "prognoos.json").exists():
        files.append(ILM / "prognoos.json")
    return ILM, files


def git(*args, env=None, inp=None):
    r = subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", *args], cwd=BASE,
                       env=env, input=inp, capture_output=True, text=False)
    if r.returncode:
        raise SystemExit(f"git {' '.join(args)}:\n{r.stderr.decode(errors='replace')}")
    return r.stdout.decode().strip()


def avalda(haru, root, files, kuiv=False):
    big = [f for f in files if f.stat().st_size > MAX_FAIL]
    if big:
        raise SystemExit(f"Üle 25 MiB (Pages ei võta): {[str(f) for f in big]}")
    size = sum(f.stat().st_size for f in files)
    print(f"{haru}: {len(files)} faili, {size / 1e6:.1f} MB ({root})")
    if kuiv:
        return
    git_dir = git("rev-parse", "--absolute-git-dir")
    with tempfile.TemporaryDirectory() as tmp:
        env = dict(os.environ, GIT_INDEX_FILE=str(Path(tmp) / "index"), GIT_DIR=git_dir, GIT_WORK_TREE=str(root))
        paths = b"\0".join(f.relative_to(root).as_posix().encode() for f in sorted(files)) + b"\0"
        # -f: leht/andmed and andmed/ are in .gitignore
        subprocess.run(["git", "-c", "core.autocrlf=false", "-c", "core.safecrlf=false", "add", "-f",
                        "--pathspec-from-file=-", "--pathspec-file-nul"],
                       cwd=root, env=env, input=paths, check=True)
        tree = git("write-tree", env=env)
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    commit = git("commit-tree", tree, "-m", f"{haru}: {len(files)} faili, {stamp}")
    git("push", "--force", "origin", f"{commit}:refs/heads/{haru}")
    print(f"  origin/{haru} = {commit[:10]} (üks commit, force push)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("haru", nargs="?", default="andmed", choices=["andmed", "ilm"])
    ap.add_argument("--kuiv", action="store_true", help="only list what would be pushed")
    a = ap.parse_args()
    root, files = andmed_failid() if a.haru == "andmed" else ilm_failid()
    avalda(a.haru, root, files, a.kuiv)


if __name__ == "__main__":
    sys.exit(main())
