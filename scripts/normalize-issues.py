#!/usr/bin/env python3
"""Split spread pages and write CONTRACT v1 artifacts for every proud issue PDF.

Reads source PDFs from --pdf-dir, writes pages/PPP-{s,m,l}.webp, proud-NN.pdf,
review/contact.jpg and the manifest data/input/issues/NN.json.

Idempotent: an issue is skipped when its manifest exists, its source sha256
matches and --force is absent. Binaries go into NN.tmp and are renamed to NN
when the issue is complete; the manifest is written last. Pages run in a
process pool of 6; the parent assembles PDF and manifest in reading order.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import fitz

ISSUES = [f"{n:02d}" for n in list(range(0, 10)) + list(range(11, 33))]
EXPECTED_PAGES = {"27": 84}
DEFAULT_PAGES = 68
VARIANTS = {"s": (360, 70), "m": (900, 82), "l": (1800, 82)}
WORKERS = 6
PDF_WIDTH = 595.0
SINGLE_ASPECT = 0.746
SPREAD_ASPECT = 1.49
ASPECT_TOL = 0.05
SEAM_DELTA = 0.12
FONT = next((p for p in ("/System/Library/Fonts/Helvetica.ttc",
                         "/System/Library/Fonts/Supplemental/Arial.ttf") if Path(p).exists()), "")


def run(cmd: list[str]) -> str:
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        raise RuntimeError(f"{' '.join(cmd)}: {result.stderr.strip()[-400:]}")
    return result.stdout


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_file(pdf_dir: Path, issue: str) -> Path:
    return pdf_dir / ("28 proud.pdf" if issue == "28" else f"{issue} proud issuu_output.pdf")


def image_to_png(data: bytes, rotation: int, dest: Path, raw: Path) -> None:
    raw.write_bytes(data)
    cmd = ["magick", str(raw)]
    if rotation:
        cmd += ["-rotate", str(rotation)]
    cmd += ["-background", "white", "-alpha", "remove", "-alpha", "off",
            "-colorspace", "sRGB", "-strip", f"PNG24:{dest}"]
    run(cmd)


def page_pngs(doc, page, work: Path, pno: int) -> tuple[str, list[Path]]:
    """Return (mode, png files). mode is 'one', 'two' or 'render'."""
    infos = [i for i in page.get_image_info(xrefs=True) if i["width"] and i["height"]]
    area = page.rect.width * page.rect.height
    full = [i for i in infos if fitz.Rect(i["bbox"]).get_area() >= 0.98 * area]
    if len(full) == 1:
        infos, mode = full, "one"
    elif len(infos) >= 2:
        infos = sorted(infos[:2], key=lambda i: (i["bbox"][0], i["bbox"][1]))
        mode = "two"
    else:
        infos, mode = [], "render"

    out: list[Path] = []
    if mode == "render":
        scale = 1.0
        if infos:
            scale = max(0.1, infos[0]["width"] / page.rect.width)
        pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        dest = work / f"p{pno:03d}.png"
        pix.save(dest)
        return mode, [dest]

    for index, info in enumerate(infos):
        ext = {"jpeg": "jpg"}.get(info.get("ext", "png"), info.get("ext", "png"))
        data = doc.extract_image(info["xref"])["image"]
        dest = work / f"p{pno:03d}-{index}.png"
        image_to_png(data, page.rotation, dest, work / f"p{pno:03d}-{index}.raw.{ext}")
        out.append(dest)
    return mode, out


def size_of(path: Path) -> tuple[int, int]:
    w, h = run(["magick", "identify", "-format", "%w %h", str(path)]).split()
    return int(w), int(h)


def mean_luma(png: Path, width: int, height: int, x: int) -> float:
    x = max(0, min(x, width - 6))
    return float(run(["magick", str(png), "-crop", f"6x{height}+{x}+0", "+repage",
                      "-format", "%[fx:mean]", "info:"]))


def seam(png: Path, width: int, height: int) -> dict:
    center = mean_luma(png, width, height, width // 2 - 3)
    left = mean_luma(png, width, height, width // 4 - 3)
    right = mean_luma(png, width, height, 3 * width // 4 - 3)
    return {"center": round(center, 4), "q25": round(left, 4), "q75": round(right, 4),
            "outlier": abs(center - left) > SEAM_DELTA and abs(center - right) > SEAM_DELTA}


def process_page(task: tuple[str, int, str]) -> dict:
    """Worker: one source page in, webp variants plus one pdf JPEG out."""
    pdf_path, pno, workdir = task
    work = Path(workdir)
    doc = fitz.open(pdf_path)
    page = doc[pno]
    mode, pngs = page_pngs(doc, page, work, pno + 1)
    result = {"pno": pno + 1, "mode": mode, "items": [], "seams": [], "aspects": [], "notes": []}
    if mode == "render":
        result["notes"].append(f"page {pno + 1} rendered")

    for order, png in enumerate(pngs):
        w, h = size_of(png)
        aspect = w / h
        if not (abs(aspect - SINGLE_ASPECT) <= ASPECT_TOL * SINGLE_ASPECT
                or abs(aspect - SPREAD_ASPECT) <= ASPECT_TOL * SPREAD_ASPECT):
            result["aspects"].append({"page": pno + 1, "aspect": round(aspect, 4),
                                      "w": w, "h": h})
        parts: list[tuple[Path, str | None]] = [(png, None)]
        if mode == "two":
            parts = [(png, "L" if order == 0 else "R")]
        elif aspect > 1.0:
            hw = w // 2
            left = work / f"p{pno + 1:03d}-{order}-L.png"
            right = work / f"p{pno + 1:03d}-{order}-R.png"
            run(["magick", str(png), "-crop", f"{hw}x{h}+0+0", "+repage", f"PNG24:{left}"])
            run(["magick", str(png), "-crop", f"{hw}x{h}+{w - hw}+0", "+repage", f"PNG24:{right}"])
            stat = seam(png, w, h)
            stat["page"] = pno + 1
            result["seams"].append(stat)
            parts = [(left, "L"), (right, "R")]

        for part_index, (part, side) in enumerate(parts):
            pw, ph = size_of(part)
            stem = work / f"p{pno + 1:03d}-{order}-{part_index}"
            webp = {}
            lw = lh = 0
            for key, (cap, quality) in VARIANTS.items():
                target = Path(f"{stem}-{key}.webp")
                want = min(cap, pw)
                run(["cwebp", "-q", str(quality), "-m", "4", "-resize", str(want), "0",
                     str(part), "-o", str(target)])
                gw, gh = size_of(target)
                if abs(gw - want) > 1 or abs(gh - ph * want / pw) > 1.5:
                    raise RuntimeError(f"{target.name} {gw}x{gh} want {want}x{ph * want / pw:.1f}")
                webp[key] = str(target)
                if key == "l":
                    lw, lh = gw, gh
            jpg = Path(f"{stem}.jpg")
            run(["magick", str(part), "-resize", "1800x>", "-quality", "82",
                 "-sampling-factor", "4:2:0", "-strip", f"jpg:{jpg}"])
            result["items"].append({"pno": pno + 1, "order": order, "side": side,
                                    "w": pw, "h": ph, "lw": lw, "lh": lh,
                                    "webp": webp, "jpg": str(jpg)})
            if part is not png:
                part.unlink()
        png.unlink()

    for extra in work.glob(f"p{pno + 1:03d}-*.raw.*"):
        extra.unlink()
    doc.close()
    return result


def make_pdf(jpgs: list[tuple[Path, int, int]], dest: Path, issue: str, quality: int) -> int:
    doc = fitz.open()
    for index, (jpg, width, height) in enumerate(jpgs):
        source = jpg
        if quality < 82:
            lower = jpg.with_name(f"{jpg.stem}-q{quality}.jpg")
            run(["magick", str(jpg), "-quality", str(quality), "-strip", f"jpg:{lower}"])
            source = lower
        page = doc.new_page(width=PDF_WIDTH, height=PDF_WIDTH * height / width)
        page.insert_image(page.rect, filename=str(source))
    doc.set_metadata({"title": f"proud #{issue}", "author": "proud magazine Berlin",
                      "subject": f"proud magazine issue {issue}, archive edition"})
    doc.save(dest, deflate=True, garbage=4)
    doc.close()
    return dest.stat().st_size


def contact_sheet(thumbs: list[Path], dest: Path) -> None:
    run(["magick", "montage", *map(str, thumbs), "-font", FONT, "-tile", "12x",
         "-geometry", "190x+2+2", "-background", "white", "-quality", "70", str(dest)])


def build_issue(issue: str, pdf_dir: Path, out_root: Path, manifest_dir: Path) -> dict:
    source = source_file(pdf_dir, issue)
    if not source.is_file():
        raise RuntimeError(f"missing source {source}")
    digest = sha256_file(source)
    final = out_root / issue
    work = out_root / f"{issue}.tmp"
    if work.exists():
        shutil.rmtree(work)
    (work / "pages").mkdir(parents=True)
    (work / "review").mkdir()

    doc = fitz.open(source)
    source_pages = doc.page_count
    doc.close()

    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(process_page, [(str(source), p, str(work))
                                               for p in range(source_pages)]))

    notes: list[str] = []
    pages_info: list[dict] = []
    seams: list[dict] = []
    aspects: list[dict] = []
    jpgs: list[tuple[Path, int, int]] = []
    used_two = False
    n = 0
    for result in results:
        used_two |= result["mode"] == "two"
        notes.extend(result["notes"])
        seams.extend(result["seams"])
        aspects.extend(result["aspects"])
        for item in result["items"]:
            n += 1
            for key in VARIANTS:
                os.replace(item["webp"][key], work / "pages" / f"{n:03d}-{key}.webp")
            jpg = work / f"pdf-{n:03d}.jpg"
            os.replace(item["jpg"], jpg)
            jpgs.append((jpg, item["lw"], item["lh"]))
            pages_info.append({"n": n, "srcPage": item["pno"], "half": item["side"],
                               "w": item["lw"], "h": item["lh"]})
    if used_two:
        notes.append("two images side by side, taken directly per page")

    pdf_name = f"proud-{issue}.pdf"
    quality = 82
    pdf_bytes = make_pdf(jpgs, work / pdf_name, issue, quality)
    while pdf_bytes > 40 * 1024 * 1024 and quality > 72:
        quality -= 5
        pdf_bytes = make_pdf(jpgs, work / pdf_name, issue, quality)
    if quality != 82:
        notes.append(f"web pdf jpeg quality {quality}")

    thumbs = sorted((work / "pages").glob("*-s.webp"))
    contact_sheet(thumbs, work / "review" / "contact.jpg")
    for jpg, _w, _h in jpgs:
        jpg.unlink()

    spread_src = sorted({s["page"] for s in seams})
    single_src = [p for p in range(1, source_pages + 1) if p not in spread_src]
    if not spread_src:
        layout = "single" if not used_two else "spreads"
    elif all(p in (1, source_pages) for p in single_src):
        layout = "spreads"
    else:
        layout = "mixed"

    expected = EXPECTED_PAGES.get(issue, DEFAULT_PAGES)
    if n != expected:
        notes.append(f"page count {n}, expected {expected}")
        bad = [f"{a['page']}:{a['aspect']}" for a in aspects]
        if bad:
            notes.append("off aspects " + " ".join(bad))
    if issue == "22" and (pdf_dir / "22-proud-magazine-2011.pdf").is_file():
        notes.append("alternate source 22-proud-magazine-2011.pdf (vector text) available")
    low_res = pages_info[0]["w"] < 1200

    if final.exists():
        shutil.rmtree(final)
    work.rename(final)

    manifest = {
        "issue": issue,
        "title": f"proud #{issue}",
        "pages": n,
        "layout": layout,
        "source": {"file": source.name, "pdfPages": source_pages, "bytes": source.stat().st_size,
                   "sha256": digest},
        "pageSize": {"w": results[0]["items"][0]["w"], "h": results[0]["items"][0]["h"]},
        "pagesInfo": pages_info,
        "variants": {k: v[0] for k, v in VARIANTS.items()},
        "web": {"pdf": pdf_name, "bytes": (final / pdf_name).stat().st_size,
                "sha256": sha256_file(final / pdf_name)},
        "lowRes": low_res,
        "notes": notes,
    }
    (manifest_dir / f"{issue}.json").write_text(json.dumps(manifest, indent=1) + "\n")
    return {"issue": issue, "pages": n, "layout": layout, "spreads": len(spread_src),
            "pdfMB": round(manifest["web"]["bytes"] / 1048576, 2),
            "dirMB": round(sum(p.stat().st_size for p in final.rglob("*") if p.is_file()) / 1048576, 2),
            "lowRes": low_res, "notes": notes, "seams": seams, "aspects": aspects,
            "pdfPages": source_pages, "source": source.name}


def verify(issue: str, pdf_dir: Path, out_root: Path, manifest_dir: Path) -> list[str]:
    bad: list[str] = []
    path = manifest_dir / f"{issue}.json"
    if not path.is_file():
        return ["no manifest"]
    try:
        man = json.loads(path.read_text())
    except json.JSONDecodeError as error:
        return [f"manifest json {error}"]
    source = source_file(pdf_dir, issue)
    if not source.is_file():
        bad.append("missing source")
    elif source.stat().st_size < 2048 and man["source"]["bytes"] >= 2048:
        pass  # git-lfs stub in a worktree, bytes are unknown here
    elif sha256_file(source) != man["source"]["sha256"]:
        bad.append("source sha mismatch")
    expected = EXPECTED_PAGES.get(issue, DEFAULT_PAGES)
    if man["pages"] != expected:
        bad.append(f"pages {man['pages']} != {expected}")
    if len(man["pagesInfo"]) != man["pages"]:
        bad.append("pagesInfo length")
    root = out_root / issue
    for info in man["pagesInfo"]:
        for key in VARIANTS:
            target = root / "pages" / f"{info['n']:03d}-{key}.webp"
            if not target.is_file():
                bad.append(f"missing {target.name}")
                continue
            got = size_of(target)
            want_w = info["w"] if key == "l" else min(man["variants"][key], info["w"])
            want_h = info["h"] * want_w / info["w"]
            if abs(got[0] - want_w) > 1 or abs(got[1] - want_h) > 1.5:
                bad.append(f"{target.name} {got[0]}x{got[1]}")
    pdf = root / man["web"]["pdf"]
    if not pdf.is_file():
        bad.append("missing pdf")
    else:
        if pdf.stat().st_size != man["web"]["bytes"]:
            bad.append("pdf bytes")
        if sha256_file(pdf) != man["web"]["sha256"]:
            bad.append("pdf sha")
        document = fitz.open(pdf)
        if document.page_count != man["pages"]:
            bad.append(f"pdf pages {document.page_count}")
        for page in document:
            if abs(page.rect.width - PDF_WIDTH) > 0.5:
                bad.append(f"pdf page width {page.rect.width}")
                break
        document.close()
    contact = root / "review" / "contact.jpg"
    if not contact.is_file():
        bad.append("missing contact sheet")
    elif size_of(contact)[0] > 2400:
        bad.append("contact too wide")
    return bad


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-dir", type=Path, default=Path("data/input/pdfs"))
    parser.add_argument("--out", type=Path, default=Path("data/output/issues"))
    parser.add_argument("--manifests", type=Path, default=Path("data/input/issues"))
    parser.add_argument("--progress", type=Path)
    parser.add_argument("--only", action="append")
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    pdf_dir, out_root, manifest_dir = (p.resolve() for p in (args.pdf_dir, args.out, args.manifests))
    manifest_dir.mkdir(parents=True, exist_ok=True)
    out_root.mkdir(parents=True, exist_ok=True)
    targets = args.only or ISSUES

    if args.verify:
        failures = 0
        for issue in targets:
            bad = verify(issue, pdf_dir, out_root, manifest_dir)
            print(f"{issue} {'OK' if not bad else 'FAIL ' + '; '.join(bad)}")
            failures += bool(bad)
        print(f"{len(targets) - failures} of {len(targets)} OK")
        return 1 if failures else 0

    for issue in targets:
        manifest = manifest_dir / f"{issue}.json"
        source = source_file(pdf_dir, issue)
        if (manifest.is_file() and source.is_file() and not args.force
                and json.loads(manifest.read_text())["source"]["sha256"] == sha256_file(source)):
            print(f"{issue} skip (manifest current)", flush=True)
            continue
        started = time.time()
        result = build_issue(issue, pdf_dir, out_root, manifest_dir)
        print(json.dumps({k: result[k] for k in ("issue", "pdfPages", "pages", "layout",
                                                 "spreads", "pdfMB", "dirMB", "lowRes")}), flush=True)
        for stat in result["seams"]:
            if stat["outlier"]:
                print(f"  seam outlier page {stat['page']} center {stat['center']} "
                      f"q25 {stat['q25']} q75 {stat['q75']}", flush=True)
        for item in result["aspects"]:
            print(f"  off aspect page {item['page']} {item['aspect']} {item['w']}x{item['h']}", flush=True)
        if args.progress:
            with args.progress.open("a") as handle:
                handle.write(f"{time.strftime('%H:%M:%S')} issue {issue} ok pages={result['pages']} "
                             f"layout={result['layout']} spreads={result['spreads']} "
                             f"pdfMB={result['pdfMB']} dirMB={result['dirMB']} "
                             f"{round(time.time() - started)}s "
                             f"{out_root / issue}/review/contact.jpg\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
