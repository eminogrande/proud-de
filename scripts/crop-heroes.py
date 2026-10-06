#!/usr/bin/env python3
"""Crop standalone hero images out of magazine page scans.

Reads every data/input/hero-crops/*.json manifest (sorted by name, later files win):
  { "<article-slug>": { "page": <1-based PDF page>, "bbox": [x1, y1, x2, y2],
                        "kind": "photo"|"illustration"|"graphic"|"none", "note": "..." } }
bbox is in pixels of the embedded page image (2235x2996 for the proud scans).

For each entry with kind != "none" it extracts the page image from the source PDF
(data/input/pdfs/<sourcePdf> via data/output/library.json), crops it, writes
data/output/hero/<slug>.jpg (quality 88, long edge <= 1800px) and sets
heroImage = "hero/<slug>.jpg" in data/output/articles/<slug>.json and library.json.
Entries that are "none", invalid or missing get heroImage removed. Idempotent.

Usage: python3 scripts/crop-heroes.py [--root DIR]
Requires Pillow and poppler (pdfimages, pdftoppm).
"""
import argparse
import glob
import json
import os
import shutil
import subprocess
import sys
import tempfile

from PIL import Image

MAX_EDGE = 1800
QUALITY = 88
VALID_KINDS = {"photo", "illustration", "graphic"}


def warn(msg):
    print(f"warning: {msg}", file=sys.stderr)


def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def write_json(path, data):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    os.replace(tmp, path)


def load_manifests(root):
    merged = {}
    for path in sorted(glob.glob(os.path.join(root, "data/input/hero-crops/*.json"))):
        data = load_json(path)
        if not isinstance(data, dict):
            warn(f"{path}: not a JSON object, skipped")
            continue
        merged.update(data)
    return merged


def extract_page(pdf_path, page, workdir):
    """Return a PIL image of the page at native resolution."""
    prefix = os.path.join(workdir, f"p{page}")
    subprocess.run(["pdfimages", "-f", str(page), "-l", str(page), "-j", pdf_path, prefix],
                   check=True, capture_output=True)
    files = sorted(glob.glob(prefix + "-*"))
    if files:
        biggest = max(files, key=lambda f: Image.open(f).size[0] * Image.open(f).size[1])
        img = Image.open(biggest)
        img.load()
        return img
    # Fallback: rasterise the page (vector/compound pages).
    subprocess.run(["pdftoppm", "-f", str(page), "-l", str(page), "-singlefile", "-r", "216",
                    "-png", pdf_path, prefix + "r"], check=True, capture_output=True)
    img = Image.open(prefix + "r.png")
    img.load()
    return img


def valid_bbox(bbox, size):
    if not (isinstance(bbox, list) and len(bbox) == 4 and all(isinstance(v, (int, float)) for v in bbox)):
        return False
    x1, y1, x2, y2 = bbox
    w, h = size
    return 0 <= x1 < x2 <= w and 0 <= y1 < y2 <= h


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", default=os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    args = parser.parse_args()
    root = args.root

    library_path = os.path.join(root, "data/output/library.json")
    library = load_json(library_path)
    articles = {a["slug"]: a for a in library.get("articles", [])}
    manifest = load_manifests(root)
    hero_dir = os.path.join(root, "data/output/hero")
    os.makedirs(hero_dir, exist_ok=True)

    page_cache = {}
    done, skipped = 0, 0
    hero_for = {}
    workdir = tempfile.mkdtemp(prefix="crop-heroes-")
    try:
        for slug, entry in sorted(manifest.items()):
            if slug not in articles:
                warn(f"{slug}: unknown article slug, skipped")
                skipped += 1
                continue
            if not isinstance(entry, dict) or entry.get("kind") not in VALID_KINDS:
                continue
            article = articles[slug]
            pdf_path = os.path.join(root, "data/input/pdfs", article["sourcePdf"])
            page = entry.get("page")
            if not isinstance(page, int) or page < 1:
                warn(f"{slug}: invalid page {page!r}, skipped")
                skipped += 1
                continue
            key = (pdf_path, page)
            try:
                if key not in page_cache:
                    page_cache = {key: extract_page(pdf_path, page, workdir)}  # keep one page in memory
                img = page_cache[key]
            except (subprocess.CalledProcessError, OSError) as exc:
                warn(f"{slug}: cannot extract page {page} from {pdf_path}: {exc}")
                skipped += 1
                continue
            bbox = entry.get("bbox")
            if not valid_bbox(bbox, img.size):
                warn(f"{slug}: bbox {bbox} outside page {img.size}, skipped")
                skipped += 1
                continue
            x1, y1, x2, y2 = (int(round(v)) for v in bbox)
            crop = img.crop((x1, y1, x2, y2)).convert("RGB")
            crop.thumbnail((MAX_EDGE, MAX_EDGE), Image.Resampling.LANCZOS)
            out = os.path.join(hero_dir, f"{slug}.jpg")
            crop.save(out, "JPEG", quality=QUALITY, optimize=True, progressive=True)
            hero_for[slug] = f"hero/{slug}.jpg"
            done += 1
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    # Write heroImage fields (and clear stale ones) in article files and library.json.
    # Slugs absent from all manifests keep an existing crop if its file still exists.
    changed = 0
    for slug, lib_entry in articles.items():
        hero = hero_for.get(slug)
        existing = lib_entry.get("heroImage")
        if hero is None and slug not in manifest and existing and os.path.exists(os.path.join(root, "data/output", existing)):
            hero = existing
        article_path = os.path.join(root, "data/output", lib_entry.get("file") or f"articles/{slug}.json")
        article_data = load_json(article_path) if os.path.exists(article_path) else None
        for data in (lib_entry, article_data):
            if data is None or data.get("heroImage") == hero:
                continue
            if hero:
                data["heroImage"] = hero
            else:
                data.pop("heroImage", None)
            changed += 1
            if data is article_data:
                write_json(article_path, article_data)
    write_json(library_path, library)
    print(f"hero crops: {done} written, {skipped} skipped, {changed} JSON fields updated")


if __name__ == "__main__":
    main()
