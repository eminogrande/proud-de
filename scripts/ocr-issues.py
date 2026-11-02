#!/usr/bin/env python3
"""OCR every page of every normalized issue with Tesseract (free, local). Writes data/output/issues/NN/text.json.

Machine text, unchecked: it is for search and for later article work, never shown as a checked article.
Usage: .venv/bin/python scripts/ocr-issues.py [--only 24] [--force] [--jobs 6]
"""
import argparse, json, os, subprocess, sys, time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ISSUES = Path(os.environ.get("PROUD_ISSUES_DIR") or ROOT / "data/output/issues")
MANIFESTS = ROOT / "data/input/issues"
LANGS = "deu+eng"


def ocr_page(args):
    issue, n, tessdata = args
    img = ISSUES / issue / "pages" / f"{n:03d}-l.webp"
    env = {**os.environ, "OMP_THREAD_LIMIT": "1", "TESSDATA_PREFIX": str(tessdata)}
    png = subprocess.run(["magick", str(img), "-colorspace", "Gray", "png:-"], capture_output=True, check=True).stdout
    tsv = subprocess.run(["tesseract", "stdin", "stdout", "-l", LANGS, "--psm", "3", "tsv"], input=png, capture_output=True, env=env, check=True).stdout.decode("utf-8", "replace")
    lines, confs, key, cur = [], [], None, []
    for row in tsv.splitlines()[1:]:
        c = row.split("\t")
        if len(c) < 12 or c[0] != "5":
            continue
        conf, word = float(c[10]), c[11].strip()
        if not word or conf < 0:
            continue
        confs.append(conf)
        k = (c[2], c[3], c[4])
        if key is not None and k != key:
            lines.append(" ".join(cur)); cur = []
        key = k
        cur.append(word)
    if cur:
        lines.append(" ".join(cur))
    return {"n": n, "words": len(confs), "conf": round(sum(confs) / len(confs), 1) if confs else 0.0, "text": "\n".join(lines)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", action="append")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--jobs", type=int, default=6)
    ap.add_argument("--tessdata", type=Path, default=Path(os.environ.get("TESSDATA_PREFIX", "/opt/homebrew/share/tessdata")))
    a = ap.parse_args()
    if not (a.tessdata / "deu.traineddata").exists():
        sys.exit(f"deu.traineddata missing in {a.tessdata}")
    names = sorted(p.stem for p in MANIFESTS.glob("*.json"))
    if a.only:
        names = [n for n in names if n in a.only]
    with ProcessPoolExecutor(a.jobs) as pool:
        for name in names:
            out = ISSUES / name / "text.json"
            manifest = json.loads((MANIFESTS / f"{name}.json").read_text())
            if out.exists() and not a.force:
                print(f"{name} skip", flush=True)
                continue
            t0 = time.time()
            pages = list(pool.map(ocr_page, [(name, p["n"], a.tessdata) for p in manifest["pagesInfo"]], chunksize=2))
            tmp = out.with_suffix(".tmp")
            tmp.write_text(json.dumps({"issue": name, "lang": LANGS, "engine": "tesseract", "pages": pages}, ensure_ascii=False))
            tmp.replace(out)
            words = sum(p["words"] for p in pages)
            conf = sum(p["conf"] * p["words"] for p in pages) / max(words, 1)
            print(f"{name} ok pages={len(pages)} words={words} conf={conf:.1f} {time.time()-t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()