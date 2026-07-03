#!/usr/bin/env python3

import argparse
import base64
import csv
import html
import hashlib
import json
import os
import re
import shutil
import statistics
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

try:
    import fitz
except ImportError as error:
    print("PyMuPDF fehlt. Installiere zuerst die Python-Abhängigkeiten mit `pip install -r requirements.txt`.")
    raise SystemExit(1) from error

OCR_ENABLED = os.environ.get("PROUD_ENABLE_OCR", "").strip().lower() in {"1", "true", "yes", "on"}
PAGE_IMAGE_ENABLED = os.environ.get("PROUD_EXPORT_PAGE_IMAGES", "1").strip().lower() in {"1", "true", "yes", "on"}
PAGE_IMAGE_SCALE = float(os.environ.get("PROUD_PAGE_IMAGE_SCALE", "1.0"))
PAGE_IMAGE_QUALITY = int(os.environ.get("PROUD_PAGE_IMAGE_QUALITY", "70"))
OCR_PROVIDER = os.environ.get("PROUD_OCR_PROVIDER", "native").strip().lower()
OCR_REFRESH = os.environ.get("PROUD_OCR_REFRESH", "").strip().lower() in {"1", "true", "yes", "on"}
OPENROUTER_API_KEY = os.environ.get("OPENROUTER_API_KEY") or os.environ.get("PROUD_OPENROUTER_API_KEY")
OPENROUTER_MODEL = os.environ.get("PROUD_OCR_OPENROUTER_MODEL", "google/gemini-2.5-flash")
OPENROUTER_PDF_ENGINE = os.environ.get("PROUD_OCR_OPENROUTER_PDF_ENGINE", "mistral-ocr")
OPENROUTER_URL = os.environ.get("PROUD_OPENROUTER_URL", "https://openrouter.ai/api/v1/chat/completions")
OPENROUTER_REFERER = os.environ.get("PROUD_OPENROUTER_REFERER", "https://proud.de")
OPENROUTER_TITLE = os.environ.get("PROUD_OPENROUTER_TITLE", "proud-archive")
EDITORIAL_MODEL = os.environ.get("PROUD_EDITORIAL_MODEL", OPENROUTER_MODEL)
AI_SEGMENTATION_ENABLED = os.environ.get("PROUD_ENABLE_AI_SEGMENTATION", "1").strip().lower() in {"1", "true", "yes", "on"}
AI_EDITORIAL_ENABLED = os.environ.get("PROUD_ENABLE_AI_EDITORIAL", "1").strip().lower() in {"1", "true", "yes", "on"}
AI_LAYOUT_ENABLED = os.environ.get("PROUD_ENABLE_AI_LAYOUT", "1").strip().lower() in {"1", "true", "yes", "on"}
AI_REFRESH = os.environ.get("PROUD_AI_REFRESH", "").strip().lower() in {"1", "true", "yes", "on"}
LAYOUT_MODEL = os.environ.get("PROUD_LAYOUT_MODEL", "google/gemini-2.5-pro")
LAYOUT_REFRESH = os.environ.get("PROUD_LAYOUT_REFRESH", "").strip().lower() in {"1", "true", "yes", "on"}
LAYOUT_IMAGE_SCALE = float(os.environ.get("PROUD_LAYOUT_IMAGE_SCALE", "2.0"))
LAYOUT_MIN_CONFIDENCE = float(os.environ.get("PROUD_LAYOUT_MIN_CONFIDENCE", "20"))

PAGE_LABEL_NOISE = {
    "advertising option",
    "feature",
    "report",
    "flash",
    "start",
    "content",
    "inbox",
    "wired",
    "geared up",
    "scene",
    "navigator",
    "shoot",
    "shoot shoot",
    "last look",
    "last word",
    "style file",
    "fashion flash",
    "7days",
    "7 days",
    "days",
}


def normalize_whitespace(value: str) -> str:
    return re.sub(r"\s+", " ", (value or "")).strip()


def normalize_page_text(value: str) -> str:
    lines = [normalize_whitespace(line) for line in (value or "").splitlines()]
    lines = [line for line in lines if line and not re.fullmatch(r"\d{1,4}", line)]
    return "\n".join(lines)


def slugify(value: str) -> str:
    value = normalize_whitespace(value).lower()
    value = value.replace("ä", "ae").replace("ö", "oe").replace("ü", "ue").replace("ß", "ss")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-") or "untitled"


def unique_slug(base: str, used: set[str]) -> str:
    slug = slugify(base)
    if slug not in used:
        used.add(slug)
        return slug

    index = 2
    while f"{slug}-{index}" in used:
        index += 1

    final_slug = f"{slug}-{index}"
    used.add(final_slug)
    return final_slug


def sentence_summary(text: str, limit: int = 2) -> str:
    sentences = re.split(r"(?<=[.!?])\s+", normalize_whitespace(text))
    selected = [sentence for sentence in sentences if sentence][:limit]
    return " ".join(selected).strip()


def text_excerpt(text: str, limit: int = 260) -> str:
    compact = normalize_whitespace(text)
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1].rstrip() + "…"


def word_count(text: str) -> int:
    return len(re.findall(r"\b[\wÄÖÜäöüß-]+\b", text or ""))


def sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def markdown_to_plaintext(markdown: str) -> str:
    cleaned = markdown or ""
    cleaned = re.sub(r"<file[^>]*>", "", cleaned)
    cleaned = cleaned.replace("</file>", "")
    cleaned = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", cleaned)
    cleaned = re.sub(r"^\s{0,3}#{1,6}\s*", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\|(?:.*)\|\s*$", "", cleaned, flags=re.MULTILINE)
    cleaned = re.sub(r"^\|(?:\s*[-:]+\s*\|)+\s*$", "", cleaned, flags=re.MULTILINE)
    return normalize_page_text(cleaned)


def build_single_page_pdf(document, page_index: int) -> bytes:
    page_pdf = fitz.open()
    try:
        page_pdf.insert_pdf(document, from_page=page_index, to_page=page_index)
        return page_pdf.tobytes(garbage=3, deflate=True)
    finally:
        page_pdf.close()


def safe_json_load(file_path: Path) -> dict | None:
    if not file_path.exists():
        return None

    try:
        return json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None


def parse_openrouter_annotation(payload: dict) -> dict:
    choices = payload.get("choices") or []
    if not choices:
        return {
            "markdown": "",
            "text": "",
            "images": [],
        }

    message = choices[0].get("message") or {}
    annotations = message.get("annotations") or []
    file_annotation = next((entry for entry in annotations if entry.get("type") == "file"), None)
    if not file_annotation:
        return {
            "markdown": "",
            "text": "",
            "images": [],
        }

    content = (file_annotation.get("file") or {}).get("content") or []
    markdown_parts: list[str] = []
    images: list[str] = []

    for part in content:
        part_type = part.get("type")
        if part_type == "text":
            markdown_parts.append(part.get("text", ""))
        elif part_type == "image_url":
            url = (part.get("image_url") or {}).get("url")
            if url:
                images.append(url)

    markdown = "\n".join(part for part in markdown_parts if part).strip()
    return {
        "markdown": markdown,
        "text": markdown_to_plaintext(markdown),
        "images": images,
    }


def extract_openrouter_message_text(payload: dict) -> str:
    choices = payload.get("choices") or []
    if not choices:
        return ""

    message = choices[0].get("message") or {}
    content = message.get("content")
    if isinstance(content, str):
        return content

    if isinstance(content, list):
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                parts.append(part.get("text", ""))
        return "\n".join(part for part in parts if part).strip()

    return ""


def extract_json_payload(text: str) -> dict | list:
    value = (text or "").strip()
    if value.startswith("```"):
        value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
        value = re.sub(r"\s*```$", "", value)

    decoder = json.JSONDecoder()
    for start_index, char in enumerate(value):
        if char not in "{[":
            continue
        try:
            payload, _end = decoder.raw_decode(value[start_index:])
            return payload
        except json.JSONDecodeError:
            continue

    raise ValueError("Keine JSON-Antwort im Modell-Output gefunden.")


def call_editorial_model(system_prompt: str, user_prompt: str) -> dict | list:
    payload = {
        "model": EDITORIAL_MODEL,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": user_prompt,
            },
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    response_payload = call_openrouter(payload)
    return extract_json_payload(extract_openrouter_message_text(response_payload))


def image_mime_type(image_path: Path) -> str:
    suffix = image_path.suffix.lower()
    if suffix in {".jpg", ".jpeg"}:
        return "image/jpeg"
    if suffix == ".png":
        return "image/png"
    if suffix == ".webp":
        return "image/webp"
    return "application/octet-stream"


def image_path_to_data_url(image_path: Path) -> str:
    image_bytes = image_path.read_bytes()
    mime_type = image_mime_type(image_path)
    encoded = base64.b64encode(image_bytes).decode("utf-8")
    return f"data:{mime_type};base64,{encoded}"


def call_multimodal_json_model(
    *,
    system_prompt: str,
    user_prompt: str,
    image_paths: list[str],
    model: str,
) -> dict | list:
    content = [{"type": "text", "text": user_prompt}]
    for image_path in image_paths:
        content.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": image_path_to_data_url(Path(image_path)),
                },
            }
        )

    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": system_prompt,
            },
            {
                "role": "user",
                "content": content,
            },
        ],
        "response_format": {"type": "json_object"},
        "stream": False,
    }
    response_payload = call_openrouter(payload)
    return extract_json_payload(extract_openrouter_message_text(response_payload))


def openrouter_headers() -> dict[str, str]:
    if not OPENROUTER_API_KEY:
        raise RuntimeError("OPENROUTER_API_KEY fehlt für PROUD_OCR_PROVIDER=openrouter-page.")

    return {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "HTTP-Referer": OPENROUTER_REFERER,
        "X-Title": OPENROUTER_TITLE,
    }


def call_openrouter(payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        OPENROUTER_URL,
        data=body,
        headers=openrouter_headers(),
        method="POST",
    )

    attempts = 3
    for attempt in range(1, attempts + 1):
        try:
            with urllib.request.urlopen(request, timeout=240) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as error:
            response_text = error.read().decode("utf-8", errors="replace")
            if error.code in {408, 409, 425, 429, 500, 502, 503, 504} and attempt < attempts:
                time.sleep(attempt * 2)
                continue
            raise RuntimeError(f"OpenRouter OCR Fehler ({error.code}): {response_text[:500]}") from error
        except urllib.error.URLError as error:
            if attempt < attempts:
                time.sleep(attempt * 2)
                continue
            raise RuntimeError(f"OpenRouter OCR nicht erreichbar: {error}") from error

    raise RuntimeError("OpenRouter OCR fehlgeschlagen.")


def run_openrouter_page_ocr(
    document,
    pdf_name: str,
    pdf_slug: str,
    page_index: int,
    output_dir: Path,
) -> dict:
    cache_dir = output_dir / "ocr" / pdf_slug / "pages"
    cache_dir.mkdir(parents=True, exist_ok=True)

    page_number = page_index + 1
    raw_path = cache_dir / f"page-{page_number:03d}.json"
    markdown_path = cache_dir / f"page-{page_number:03d}.md"

    if not OCR_REFRESH:
        cached_payload = safe_json_load(raw_path)
        if cached_payload:
            parsed = parse_openrouter_annotation(cached_payload)
            if parsed["markdown"] and not markdown_path.exists():
                markdown_path.write_text(parsed["markdown"], encoding="utf-8")
            return {
                **parsed,
                "provider": f"openrouter:{OPENROUTER_PDF_ENGINE}",
                "rawFile": raw_path.as_posix(),
                "cached": True,
            }

    page_pdf = build_single_page_pdf(document, page_index)
    data_url = f"data:application/pdf;base64,{base64.b64encode(page_pdf).decode('utf-8')}"
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "Respond with OK.",
                    },
                    {
                        "type": "file",
                        "file": {
                            "filename": f"{Path(pdf_name).stem}-page-{page_number:03d}.pdf",
                            "file_data": data_url,
                        },
                    },
                ],
            }
        ],
        "plugins": [
            {
                "id": "file-parser",
                "pdf": {
                    "engine": OPENROUTER_PDF_ENGINE,
                },
            }
        ],
        "stream": False,
    }

    response_payload = call_openrouter(payload)
    raw_path.write_text(json.dumps(response_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    parsed = parse_openrouter_annotation(response_payload)
    if parsed["markdown"]:
        markdown_path.write_text(parsed["markdown"], encoding="utf-8")

    return {
        **parsed,
        "provider": f"openrouter:{OPENROUTER_PDF_ENGINE}",
        "rawFile": raw_path.as_posix(),
        "cached": False,
    }


def extract_blocks(page) -> tuple[str, list[dict]]:
    text = normalize_page_text(page.get_text("text"))
    data = page.get_text("dict")
    blocks: list[dict] = []

    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue

        for line in block.get("lines", []):
            spans = [span for span in line.get("spans", []) if normalize_whitespace(span.get("text", ""))]
            if not spans:
                continue

            line_text = normalize_whitespace("".join(span.get("text", "") for span in spans))
            if not line_text:
                continue

            bbox = line.get("bbox") or block.get("bbox") or [0, 0, 0, 0]
            size = max(float(span.get("size", 0)) for span in spans)
            blocks.append(
                {
                    "text": line_text,
                    "size": size,
                    "bbox": bbox,
                }
            )

    return text, blocks


def run_tesseract(page) -> str:
    tesseract = shutil.which("tesseract")
    if not tesseract:
        return ""

    languages = os.environ.get("PROUD_OCR_LANG", "deu+eng")
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as temp_file:
            pixmap = page.get_pixmap(matrix=fitz.Matrix(2.0, 2.0), alpha=False)
            pixmap.save(temp_file.name)
            image_path = temp_file.name

        command = [tesseract, image_path, "stdout", "-l", languages]
        result = subprocess.run(command, capture_output=True, text=True, errors="replace", check=False)
        return normalize_page_text(result.stdout)
    finally:
        if "image_path" in locals() and os.path.exists(image_path):
            os.unlink(image_path)


def run_tesseract_layout(page, pdf_slug: str, page_number: int, output_dir: Path) -> dict:
    tesseract = shutil.which("tesseract")
    if not tesseract:
        return {
            "imageFile": None,
            "lines": [],
        }

    cache_dir = output_dir / "ocr" / pdf_slug / "layout"
    cache_dir.mkdir(parents=True, exist_ok=True)
    layout_path = cache_dir / f"page-{page_number:03d}.json"
    image_path = cache_dir / f"page-{page_number:03d}.jpg"

    if layout_path.exists() and image_path.exists() and not OCR_REFRESH and not LAYOUT_REFRESH:
        cached = safe_json_load(layout_path)
        if isinstance(cached, dict) and isinstance(cached.get("lines"), list):
            cached["imageFile"] = image_path.as_posix()
            return cached

    pixmap = page.get_pixmap(matrix=fitz.Matrix(LAYOUT_IMAGE_SCALE, LAYOUT_IMAGE_SCALE), alpha=False)
    pixmap.save(image_path.as_posix(), jpg_quality=80)

    languages = os.environ.get("PROUD_OCR_LANG", "deu+eng")
    command = [tesseract, image_path.as_posix(), "stdout", "-l", languages, "tsv"]
    result = subprocess.run(command, capture_output=True, text=True, errors="replace", check=False)
    rows = result.stdout.splitlines()
    reader = csv.DictReader(rows, delimiter="\t")

    grouped_lines: dict[tuple[int, int, int], dict] = {}
    for row in reader:
        text = normalize_whitespace(row.get("text", ""))
        if not text:
            continue

        try:
            confidence = float(row.get("conf") or -1)
        except ValueError:
            confidence = -1

        if confidence < LAYOUT_MIN_CONFIDENCE:
            continue

        try:
            block_number = int(row.get("block_num") or 0)
            paragraph_number = int(row.get("par_num") or 0)
            line_number = int(row.get("line_num") or 0)
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
        except ValueError:
            continue

        key = (block_number, paragraph_number, line_number)
        entry = grouped_lines.setdefault(
            key,
            {
                "blockNumber": block_number,
                "paragraphNumber": paragraph_number,
                "lineNumber": line_number,
                "words": [],
            },
        )
        entry["words"].append(
            {
                "text": text,
                "left": left,
                "top": top,
                "right": left + width,
                "bottom": top + height,
                "width": width,
                "height": height,
                "confidence": confidence,
            }
        )

    lines: list[dict] = []
    for index, entry in enumerate(
        sorted(
            grouped_lines.values(),
            key=lambda item: (
                min(word["top"] for word in item["words"]),
                min(word["left"] for word in item["words"]),
            ),
        ),
        start=1,
    ):
        words = sorted(entry["words"], key=lambda word: word["left"])
        left = min(word["left"] for word in words)
        top = min(word["top"] for word in words)
        right = max(word["right"] for word in words)
        bottom = max(word["bottom"] for word in words)
        line_text = normalize_whitespace(" ".join(word["text"] for word in words))
        if not line_text:
            continue

        lines.append(
            {
                "id": f"l{index:03d}",
                "blockNumber": entry["blockNumber"],
                "paragraphNumber": entry["paragraphNumber"],
                "lineNumber": entry["lineNumber"],
                "bbox": [left, top, right, bottom],
                "left": left,
                "top": top,
                "right": right,
                "bottom": bottom,
                "width": right - left,
                "height": bottom - top,
                "confidence": round(
                    sum(word["confidence"] for word in words) / max(1, len(words)),
                    3,
                ),
                "text": line_text,
            }
        )

    payload = {
        "scale": LAYOUT_IMAGE_SCALE,
        "imageWidth": pixmap.width,
        "imageHeight": pixmap.height,
        "lines": lines,
    }
    layout_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    payload["imageFile"] = image_path.as_posix()
    return payload


def is_table_of_contents(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 5:
        return False

    dotted = sum(1 for line in lines if re.search(r"\.{2,}\s*\d{1,3}$", line))
    numbered = sum(1 for line in lines if re.search(r"\s\d{1,3}$", line))
    return dotted >= 3 or numbered >= max(5, len(lines) // 3)


def find_title_candidate(blocks: list[dict], page_height: float, median_size: float) -> dict | None:
    candidates: list[tuple[float, dict]] = []

    for block in blocks:
        text = block["text"]
        if len(text) < 8 or len(text) > 180:
            continue

        alpha_count = sum(char.isalpha() for char in text)
        if alpha_count < 6:
            continue

        if alpha_count / max(1, len(text)) < 0.45:
            continue

        top = block["bbox"][1]
        if top > page_height * 0.55:
            continue

        size_ratio = block["size"] / max(median_size, 1.0)
        score = (size_ratio * 10) - (top / max(page_height, 1.0) * 4)
        if text.isupper():
            score -= 0.5

        candidates.append((score, block))

    if not candidates:
        return None

    candidates.sort(key=lambda item: item[0], reverse=True)
    score, block = candidates[0]
    return {
        "text": block["text"],
        "size": block["size"],
        "bbox": block["bbox"],
        "score": round(score, 3),
    }


def extract_markdown_headings(markdown: str) -> list[dict]:
    headings: list[dict] = []
    for line in (markdown or "").splitlines():
        match = re.match(r"^\s*(#{1,6})\s+(.+?)\s*$", line)
        if not match:
            continue

        title = normalize_whitespace(match.group(2))
        if not title or len(title) > 180:
            continue

        headings.append(
            {
                "level": len(match.group(1)),
                "text": title,
            }
        )

    return headings


def find_markdown_title_candidate(markdown: str, body_text: str) -> dict | None:
    headings = extract_markdown_headings(markdown)
    if not headings:
        return None

    body_length = len(normalize_whitespace(body_text))
    for heading in headings:
        text = heading["text"]
        alpha_count = sum(char.isalpha() for char in text)
        if alpha_count < 5:
            continue

        score = 12 - heading["level"]
        if body_length > 350:
            score += 2
        if len(headings) > 4:
            score -= 2

        return {
            "text": text,
            "level": heading["level"],
            "score": round(score, 3),
        }

    return None


def analyze_text_lines(text: str) -> dict:
    lines = [normalize_whitespace(line) for line in (text or "").splitlines() if normalize_whitespace(line)]
    if not lines:
        return {
            "lineCount": 0,
            "shortLineRatio": 0.0,
        }

    short_line_count = sum(1 for line in lines if len(line) < 48)
    return {
        "lineCount": len(lines),
        "shortLineRatio": short_line_count / len(lines),
    }


def spread_for_page(page_number: int, page_count: int) -> list[int]:
    if page_number <= 1 or page_number >= page_count:
        return [page_number]
    if page_number % 2 == 0:
        return [page_number, min(page_count, page_number + 1)]
    return [max(1, page_number - 1), page_number]


def is_page_label_noise(line: str) -> bool:
    normalized = normalize_whitespace(line).strip().lower()
    if not normalized:
        return False
    if normalized in PAGE_LABEL_NOISE:
        return True
    if re.fullmatch(r"(?:\d{4}\s*){3,}", normalized):
        return True
    if normalized in {"book", "me"}:
        return True
    return False


def normalize_ocr_markdown(markdown: str) -> str:
    raw = html.unescape(markdown or "")
    raw = re.sub(r"<file[^>]*>", "", raw)
    raw = raw.replace("</file>", "")
    raw = re.sub(r"!\[[^\]]*\]\([^)]+\)", "", raw)
    raw = re.sub(r"^\|(?:.*)\|\s*$", "", raw, flags=re.MULTILINE)
    raw = re.sub(r"^\|(?:\s*[-:]+\s*\|)+\s*$", "", raw, flags=re.MULTILINE)

    lines: list[str] = []
    for source_line in raw.splitlines():
        line = normalize_whitespace(source_line)
        if not line:
            if lines and lines[-1] != "":
                lines.append("")
            continue

        if line.startswith("#"):
            prefix, _, remainder = line.partition(" ")
            heading_text = normalize_whitespace(remainder or prefix.lstrip("#"))
            if heading_text and not is_page_label_noise(heading_text):
                lines.append(f"{prefix} {heading_text}")
            continue

        if is_page_label_noise(line):
            continue

        lines.append(line)

    while lines and lines[0] == "":
        lines.pop(0)
    while lines and lines[-1] == "":
        lines.pop()

    normalized_lines: list[str] = []
    previous_blank = False
    for line in lines:
        if line == "":
            if previous_blank:
                continue
            previous_blank = True
            normalized_lines.append(line)
            continue

        previous_blank = False
        normalized_lines.append(line)

    return "\n".join(normalized_lines).strip()


def looks_like_ad_or_structure_title(title: str, magazine_title: str) -> bool:
    normalized = normalize_whitespace(html.unescape(title)).lower()
    magazine_normalized = normalize_whitespace(magazine_title).lower()
    if not normalized:
        return True
    if normalized == magazine_normalized:
        return True
    if normalized in {"book me", "book", "me", "content", "start", "proud"}:
        return True
    if any(token in normalized for token in {"schutzatmosphäre", "kochfest", "qualität", "geschmacks-verstärkern"}):
        return True
    if normalized.startswith("„") and normalized.endswith("“"):
        return True
    return False


def extract_sections_from_markdown(markdown: str, page_number: int, page_count: int) -> list[dict]:
    cleaned = normalize_ocr_markdown(markdown)
    if not cleaned:
        return []

    lines = cleaned.splitlines()
    sections: list[dict] = []
    current_lines: list[str] = []
    current_title: str | None = None

    def finalize() -> None:
        nonlocal current_lines, current_title
        block_lines = [line for line in current_lines]
        while block_lines and not block_lines[0].strip():
            block_lines.pop(0)
        while block_lines and not block_lines[-1].strip():
            block_lines.pop()
        if not block_lines:
            current_lines = []
            current_title = None
            return

        block_markdown = "\n".join(block_lines).strip()
        block_text = markdown_to_plaintext(block_markdown)
        if word_count(block_text) < 4 and not current_title:
            current_lines = []
            current_title = None
            return

        section_index = len(sections) + 1
        section_id = f"p{page_number:03d}s{section_index:02d}"
        sections.append(
            {
                "id": section_id,
                "pageNumber": page_number,
                "spreadPages": spread_for_page(page_number, page_count),
                "title": html.unescape(current_title) if current_title else None,
                "markdown": block_markdown,
                "text": block_text,
                "wordCount": word_count(block_text),
                "sample": text_excerpt(block_text, 220),
                "hasHeading": current_title is not None,
            }
        )
        current_lines = []
        current_title = None

    for line in lines:
        if line.startswith("# "):
            if current_lines:
                finalize()
            current_title = normalize_whitespace(line[2:])
            current_lines = [f"# {current_title}"]
            continue

        if current_title is None and not current_lines:
            current_lines = []

        current_lines.append(line)

    finalize()
    return sections


def build_issue_section_candidates(
    page_infos: list[dict],
    page_count: int,
    magazine_title: str,
    pdf_slug: str,
    output_dir: Path,
) -> list[dict]:
    sections: list[dict] = []
    for page in page_infos:
        markdown_sections = extract_sections_from_markdown(page.get("ocrMarkdown", ""), page["pageNumber"], page_count)
        page_sections = merge_markdown_sections_with_layout(page, page_count, markdown_sections)
        if should_run_layout_analysis(page):
            ai_sections = analyze_page_layout_with_ai(
                pdf_slug=pdf_slug,
                magazine_title=magazine_title,
                page=page,
                page_count=page_count,
                output_dir=output_dir,
            )
            if ai_sections:
                page_sections = ai_sections
        if not page_sections and page.get("text"):
            fallback_text = normalize_ocr_markdown(page.get("text", ""))
            if fallback_text and word_count(fallback_text) >= 8:
                page_sections = extract_sections_from_markdown(fallback_text, page["pageNumber"], page_count)

        if not page_sections and word_count(page.get("text", "")) >= 12:
            plain = normalize_page_text(page.get("text", ""))
            page_sections = [
                {
                    "id": f"p{page['pageNumber']:03d}s01",
                    "pageNumber": page["pageNumber"],
                    "spreadPages": spread_for_page(page["pageNumber"], page_count),
                    "title": None,
                    "markdown": plain,
                    "text": plain,
                    "wordCount": word_count(plain),
                    "sample": text_excerpt(plain, 220),
                    "hasHeading": False,
                }
            ]

        page["sections"] = page_sections
        sections.extend(page_sections)

    return sections


def should_run_layout_analysis(page: dict) -> bool:
    if not (AI_LAYOUT_ENABLED and OPENROUTER_API_KEY):
        return False
    layout_lines = page.get("layoutLines") or []
    heading_count = len(page.get("ocrHeadings", []))
    if len(layout_lines) < 12:
        return False
    if heading_count >= 5:
        return True
    if heading_count >= 3 and page.get("shortLineRatio", 0.0) >= 0.55 and page.get("lineCount", 0) >= 12:
        return True
    if len(layout_lines) >= 28 and page.get("shortLineRatio", 0.0) >= 0.5:
        return True
    return False


def title_token_set(value: str) -> set[str]:
    normalized = normalize_whitespace(html.unescape(value)).lower()
    tokens = re.findall(r"[a-z0-9äöüß]+", normalized)
    return {token for token in tokens if len(token) >= 2}


def normalize_title_text(value: str) -> str:
    text = normalize_whitespace(html.unescape(value))
    text = re.sub(
        r"\b([A-Za-zÄÖÜäöüß]{4,})\s+([A-Za-zÄÖÜäöüß])\b",
        lambda match: f"{match.group(1)}{match.group(2)}" if match.group(2).islower() else match.group(0),
        text,
    )
    return normalize_whitespace(text)


def infer_section_title(text: str) -> str | None:
    lines = [normalize_whitespace(line) for line in str(text or "").splitlines() if normalize_whitespace(line)]
    if not lines:
        return None

    first_line = lines[0]
    candidate = re.split(r"\bist\b|[.!?:]", first_line, maxsplit=1, flags=re.IGNORECASE)[0]
    candidate = normalize_title_text(candidate)
    if not candidate:
        return None
    if word_count(candidate) < 2 or word_count(candidate) > 6:
        return None
    if is_page_label_noise(candidate):
        return None
    return candidate


def layout_line_looks_like_title(line: dict) -> bool:
    text = normalize_whitespace(line.get("text", ""))
    if not text:
        return False

    normalized = text.lower()
    alpha_count = sum(char.isalpha() for char in text)
    if alpha_count < 4:
        return False
    if len(text) > 72:
        return False
    if word_count(text) > 8:
        return False
    if is_page_label_noise(text):
        return False
    if any(token in normalized for token in {"www.", "@", ".de", "straße", "strasse", "allee", "platz"}):
        return False
    if any(
        token in normalized
        for token in {
            "montag",
            "dienstag",
            "mittwoch",
            "donnerstag",
            "freitag",
            "samstag",
            "sonntag",
            "januar",
            "februar",
            "märz",
            "maerz",
            "april",
            "mai",
            "juni",
            "juli",
            "august",
            "september",
            "oktober",
            "november",
            "dezember",
        }
    ):
        return False
    if re.fullmatch(r"[\d\s./:-]+", normalized):
        return False
    if line.get("height", 0) >= 40:
        return True
    if line.get("height", 0) >= 34 and word_count(text) <= 4 and not re.search(r"\d", text):
        return True
    return False


def layout_clusters_share_column(cluster: dict, line: dict) -> bool:
    overlap = min(cluster["bbox"][2], line["right"]) - max(cluster["bbox"][0], line["left"])
    if overlap >= -80:
        return True
    cluster_center = (cluster["bbox"][0] + cluster["bbox"][2]) / 2
    line_center = (line["left"] + line["right"]) / 2
    return abs(cluster_center - line_center) <= 220


def is_bad_layout_cluster_title(title: str) -> bool:
    normalized = normalize_whitespace(title).lower()
    return any(token in normalized for token in {"who's opp", "who's pop", "navigator"})


def build_layout_title_clusters(page: dict) -> list[dict]:
    layout_lines = sorted(page.get("layoutLines") or [], key=lambda entry: (entry["top"], entry["left"]))
    seed_lines = [line for line in layout_lines if layout_line_looks_like_title(line)]
    clusters: list[dict] = []

    for seed in seed_lines:
        target_cluster = None
        for cluster in clusters:
            gap = seed["top"] - cluster["bbox"][3]
            if gap < -10 or gap > 110:
                continue
            if not layout_clusters_share_column(cluster, seed):
                continue
            target_cluster = cluster
            break

        if target_cluster is None:
            clusters.append(
                {
                    "lines": [seed],
                    "bbox": [seed["left"], seed["top"], seed["right"], seed["bottom"]],
                }
            )
            continue

        target_cluster["lines"].append(seed)
        target_cluster["bbox"] = [
            min(target_cluster["bbox"][0], seed["left"]),
            min(target_cluster["bbox"][1], seed["top"]),
            max(target_cluster["bbox"][2], seed["right"]),
            max(target_cluster["bbox"][3], seed["bottom"]),
        ]

    for cluster in clusters:
        for line in layout_lines:
            if line["id"] in {entry["id"] for entry in cluster["lines"]}:
                continue
            if len(cluster["lines"]) >= 3:
                continue
            gap = line["top"] - cluster["bbox"][3]
            if gap < -10 or gap > 85:
                continue
            if line.get("height", 0) < 30:
                continue
            if not layout_clusters_share_column(cluster, line):
                continue
            if is_page_label_noise(line["text"]) or re.search(r"\d", line["text"]):
                continue
            if any(token in line["text"].lower() for token in {"straße", "strasse", "allee", "club", "bar", "details auf", "location"}):
                continue
            words = [word for word in re.findall(r"[A-Za-zÄÖÜäöüß]+", line["text"]) if word]
            if line.get("height", 0) < 34 and words:
                is_title_case = all(word[0].isupper() and (word[1:].islower() or word.isupper()) for word in words)
                if is_title_case and not any(char in line["text"] for char in ".:!?&"):
                    continue
            cluster["lines"].append(line)
            cluster["bbox"] = [
                min(cluster["bbox"][0], line["left"]),
                min(cluster["bbox"][1], line["top"]),
                max(cluster["bbox"][2], line["right"]),
                max(cluster["bbox"][3], line["bottom"]),
            ]

    normalized_clusters: list[dict] = []
    for index, cluster in enumerate(sorted(clusters, key=lambda entry: (entry["bbox"][1], entry["bbox"][0])), start=1):
        unique_lines = {line["id"]: line for line in cluster["lines"]}
        lines = sorted(unique_lines.values(), key=lambda line: (line["top"], line["left"]))
        while len(lines) > 1:
            last_text = normalize_whitespace(lines[-1]["text"])
            title_case_words = [word for word in re.findall(r"[A-Za-zÄÖÜäöüß]+", last_text) if word]
            if word_count(last_text) > 3:
                lines.pop()
                continue
            if title_case_words:
                is_title_case = all(word[0].isupper() and (word[1:].islower() or word.isupper()) for word in title_case_words)
                if word_count(last_text) <= 2 and is_title_case and not any(char in last_text for char in ".:!?&"):
                    lines.pop()
                    continue
            break
        title = normalize_title_text(" ".join(line["text"] for line in lines))
        if not title:
            continue
        if is_bad_layout_cluster_title(title):
            continue
        normalized_clusters.append(
            {
                "id": f"c{index:02d}",
                "title": title,
                "bbox": cluster["bbox"],
                "lines": lines,
                "lineIds": [line["id"] for line in lines],
            }
        )

    return normalized_clusters


def title_overlap_score(left: str, right: str) -> float:
    left_tokens = title_token_set(left)
    right_tokens = title_token_set(right)
    if not left_tokens or not right_tokens:
        return 0.0
    return len(left_tokens & right_tokens) / max(1, min(len(left_tokens), len(right_tokens)))


def build_layout_section_from_cluster(cluster: dict, page: dict, page_count: int) -> dict | None:
    layout_lines = page.get("layoutLines") or []
    title_line_ids = set(cluster["lineIds"])
    cluster_center = (cluster["bbox"][0] + cluster["bbox"][2]) / 2
    cluster_width = cluster["bbox"][2] - cluster["bbox"][0]

    next_boundary = None
    for other in build_layout_title_clusters(page):
        if other["id"] == cluster["id"]:
            continue
        if other["bbox"][1] <= cluster["bbox"][1]:
            continue
        if not layout_clusters_share_column(cluster, {"left": other["bbox"][0], "right": other["bbox"][2]}):
            continue
        boundary = other["bbox"][1]
        if next_boundary is None or boundary < next_boundary:
            next_boundary = boundary
    if next_boundary is None:
        next_boundary = max((line["bottom"] for line in layout_lines), default=cluster["bbox"][3]) + 40

    collected_lines = list(cluster["lines"])
    for line in layout_lines:
        if line["id"] in title_line_ids:
            continue
        if line["top"] < cluster["bbox"][3] - 10 or line["top"] >= next_boundary - 4:
            continue
        if line["right"] < cluster["bbox"][0] - 120 or line["left"] > cluster["bbox"][2] + 220:
            continue
        line_center = (line["left"] + line["right"]) / 2
        if abs(line_center - cluster_center) > max(260, cluster_width * 0.85):
            continue
        if is_page_label_noise(line["text"]) or re.fullmatch(r"proud\s+\d+", line["text"].strip().lower()):
            continue
        if layout_line_looks_like_title(line):
            continue
        collected_lines.append(line)

    collected_lines = sorted(collected_lines, key=lambda line: (line["top"], line["left"]))
    markdown, text = build_layout_section_markdown(cluster["title"], cluster["lineIds"], collected_lines)
    if word_count(text) < 4:
        return None

    left = min(line["left"] for line in collected_lines)
    top = min(line["top"] for line in collected_lines)
    right = max(line["right"] for line in collected_lines)
    bottom = max(line["bottom"] for line in collected_lines)

    return {
        "id": f"p{page['pageNumber']:03d}h{cluster['id'][1:]}",
        "pageNumber": page["pageNumber"],
        "spreadPages": spread_for_page(page["pageNumber"], page_count),
        "title": cluster["title"],
        "markdown": markdown,
        "text": text,
        "wordCount": word_count(text),
        "sample": text_excerpt(text, 220),
        "hasHeading": True,
        "source": "layout-heuristic",
        "lineIds": [line["id"] for line in collected_lines],
        "titleLineIds": cluster["lineIds"],
        "bbox": [left, top, right, bottom],
    }


def merge_markdown_sections_with_layout(page: dict, page_count: int, markdown_sections: list[dict]) -> list[dict]:
    clusters = build_layout_title_clusters(page)
    if not clusters:
        return markdown_sections

    sections = [dict(section) for section in markdown_sections]
    for section in sections:
        if section.get("title"):
            section["title"] = normalize_title_text(section["title"])
            continue
        inferred_title = infer_section_title(section.get("text") or section.get("markdown") or "")
        if inferred_title:
            section["title"] = inferred_title
    matched_cluster_ids: set[str] = set()

    for section in sections:
        best_cluster = None
        best_score = 0.0
        for cluster in clusters:
            score = title_overlap_score(section.get("title") or "", cluster["title"])
            if score > best_score:
                best_score = score
                best_cluster = cluster

        if not best_cluster or best_score < 0.55:
            continue

        if len(best_cluster["lines"]) > 3 or word_count(best_cluster["title"]) > 7 or len(best_cluster["title"]) > 80:
            continue
        matched_cluster_ids.add(best_cluster["id"])
        current_tokens = title_token_set(section.get("title") or "")
        cluster_tokens = title_token_set(best_cluster["title"])
        if len(cluster_tokens) > len(current_tokens) or len(best_cluster["title"]) > len(section.get("title") or ""):
            if not looks_like_ad_or_structure_title(best_cluster["title"], ""):
                section["title"] = best_cluster["title"]

    synthesized_sections: list[dict] = []
    for cluster in clusters:
        if cluster["id"] in matched_cluster_ids:
            continue
        if len(cluster["lines"]) > 3 or word_count(cluster["title"]) > 7 or len(cluster["title"]) > 80:
            continue
        section = build_layout_section_from_cluster(cluster, page, page_count)
        if not section:
            continue
        synthesized_sections.append(section)

    combined_sections = sections + synthesized_sections
    combined_sections.sort(key=lambda section: (section["pageNumber"], section.get("bbox", [0, 0])[1], section.get("bbox", [0, 0])[0]))
    deduped_sections: list[dict] = []
    for section in combined_sections:
        if (
            deduped_sections
            and deduped_sections[-1]["pageNumber"] == section["pageNumber"]
            and normalize_whitespace(deduped_sections[-1].get("title") or "").lower() == normalize_whitespace(section.get("title") or "").lower()
        ):
            previous = deduped_sections[-1]
            if word_count(previous.get("text", "")) < word_count(section.get("text", "")):
                deduped_sections[-1] = section
            continue
        deduped_sections.append(section)

    return deduped_sections


def build_layout_section_markdown(title: str, title_line_ids: list[str], line_entries: list[dict]) -> tuple[str, str]:
    ordered_lines = sorted(line_entries, key=lambda line: (line["top"], line["left"]))
    body_lines = [line["text"] for line in ordered_lines if line["id"] not in title_line_ids]
    if not body_lines:
        body_lines = [line["text"] for line in ordered_lines if normalize_whitespace(line["text"]).lower() != normalize_whitespace(title).lower()]

    body = "\n".join(body_lines).strip()
    markdown = f"## {title}"
    if body:
        markdown = f"{markdown}\n\n{body}"

    text_lines = [title]
    if body_lines:
        text_lines.extend(body_lines)
    return markdown.strip(), "\n".join(text_lines).strip()


def normalize_layout_sections(
    *,
    payload: dict,
    page: dict,
    page_count: int,
    magazine_title: str,
) -> list[dict]:
    if not isinstance(payload, dict) or not isinstance(payload.get("sections"), list):
        return []

    line_index = {line["id"]: line for line in page.get("layoutLines", [])}
    used_line_ids: set[str] = set()
    sections: list[dict] = []

    for section_index, section in enumerate(payload["sections"], start=1):
        if not isinstance(section, dict):
            continue

        title = normalize_whitespace(html.unescape(str(section.get("title") or "")))
        title = normalize_title_text(title)
        raw_line_ids = [line_id for line_id in (section.get("lineIds") or []) if isinstance(line_id, str)]
        line_ids = [line_id for line_id in raw_line_ids if line_id in line_index and line_id not in used_line_ids]
        if not line_ids:
            continue

        title_line_ids = [
            line_id
            for line_id in (section.get("titleLineIds") or [])
            if isinstance(line_id, str) and line_id in line_index and line_id in line_ids
        ]
        if not title and title_line_ids:
            title = normalize_whitespace(" ".join(line_index[line_id]["text"] for line_id in title_line_ids))
        if not title:
            title = normalize_title_text(line_index[line_ids[0]]["text"])
        if not title:
            continue

        for line_id in line_ids:
            used_line_ids.add(line_id)

        line_entries = sorted((line_index[line_id] for line_id in line_ids), key=lambda line: (line["top"], line["left"]))
        markdown, text = build_layout_section_markdown(title, title_line_ids, line_entries)
        if word_count(text) < 4:
            continue
        if looks_like_ad_or_structure_title(title, magazine_title) and word_count(text) < 12:
            continue

        left = min(line["left"] for line in line_entries)
        top = min(line["top"] for line in line_entries)
        right = max(line["right"] for line in line_entries)
        bottom = max(line["bottom"] for line in line_entries)

        sections.append(
            {
                "id": f"p{page['pageNumber']:03d}v{section_index:02d}",
                "pageNumber": page["pageNumber"],
                "spreadPages": spread_for_page(page["pageNumber"], page_count),
                "title": title,
                "markdown": markdown,
                "text": text,
                "wordCount": word_count(text),
                "sample": text_excerpt(text, 220),
                "hasHeading": True,
                "source": "layout-ai",
                "kind": normalize_whitespace(str(section.get("kind") or "")) or None,
                "lineIds": line_ids,
                "titleLineIds": title_line_ids,
                "bbox": [left, top, right, bottom],
            }
        )

    sections.sort(key=lambda section: (section["bbox"][1], section["bbox"][0], section["title"].lower()))
    return sections


def analyze_page_layout_with_ai(
    *,
    pdf_slug: str,
    magazine_title: str,
    page: dict,
    page_count: int,
    output_dir: Path,
) -> list[dict]:
    if not should_run_layout_analysis(page):
        return []

    cache_dir = output_dir / "ai" / pdf_slug / "pages"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"page-{page['pageNumber']:03d}-layout.json"
    if cache_path.exists() and not AI_REFRESH and not LAYOUT_REFRESH:
        cached = safe_json_load(cache_path)
        sections = normalize_layout_sections(payload=cached or {}, page=page, page_count=page_count, magazine_title=magazine_title)
        if sections:
            return sections

    layout_lines = page.get("layoutLines") or []
    image_file = page.get("layoutImageFile")
    if not layout_lines or not image_file:
        return []

    line_payload = [
        {
            "id": line["id"],
            "block": line["blockNumber"],
            "bbox": line["bbox"],
            "text": line["text"],
        }
        for line in layout_lines
    ]
    system_prompt = """
You are segmenting a magazine spread into true standalone content cards.
Return strict JSON only.
Use the image as the ground truth and the OCR lines only as approximate evidence.
Rules:
- One visually distinct titled card = one section.
- A title may span multiple nearby lines. Merge them when they form one visual title, for example "proud knowledge" + "balkan" or "calling all" + "promoters:".
- Group date, venue, address, body text, URLs, and short descriptions with their correct title.
- Split neighboring cards even if they sit in the same column.
- Include short utility cards if they are clearly intentional standalone content.
- Ignore page furniture, page numbers, decorative OCR garbage, and unrelated poster text inside embedded images unless it is clearly part of the article card itself.
- Preserve reading order across the spread from top to bottom and left to right.
- Do not invent text. If OCR spacing or casing is obviously broken, normalize the title conservatively.
JSON schema:
{
  "sections": [
    {
      "title": "string",
      "kind": "article|event|promo|utility|listing",
      "titleLineIds": ["l001", "l002"],
      "lineIds": ["l001", "l002", "l003"]
    }
  ]
}
"""
    user_prompt = (
        f"Magazine: {magazine_title}\n"
        f"Page: {page['pageNumber']}\n"
        f"Spread pages: {spread_for_page(page['pageNumber'], page_count)}\n\n"
        "OCR lines with approximate bounding boxes:\n"
        f"{json.dumps(line_payload, ensure_ascii=False, indent=2)}\n\n"
        "Fallback OCR markdown:\n"
        f"{normalize_ocr_markdown(page.get('ocrMarkdown', ''))}\n"
    )

    try:
        payload = call_multimodal_json_model(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            image_paths=[image_file],
            model=LAYOUT_MODEL,
        )
    except Exception:
        return []

    cache_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalize_layout_sections(payload=payload, page=page, page_count=page_count, magazine_title=magazine_title)


def page_to_paragraphs(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    paragraphs: list[str] = []

    for line in lines:
        if re.fullmatch(r"\d{1,4}", line):
            continue

        if not paragraphs:
            paragraphs.append(line)
            continue

        previous = paragraphs[-1]
        if previous.endswith("-"):
            paragraphs[-1] = previous[:-1] + line
        elif previous.endswith((".", "!", "?", ":", ";")):
            paragraphs.append(line)
        else:
            paragraphs[-1] = previous + " " + line

    return paragraphs


def build_markdown(article_title: str, magazine_title: str, authors: list[str], pages: dict, text: str) -> str:
    paragraphs = page_to_paragraphs(text)
    lines = [f"# {article_title}", ""]
    lines.append(f"> Quelle: {magazine_title}, Seiten {pages['start']}-{pages['end']}")
    if authors:
        lines.append(f"> Autor:innen: {', '.join(authors)}")
    lines.append("")
    lines.extend(paragraphs)
    return "\n".join(lines).strip() + "\n"


def build_article_markdown_from_blocks(
    article_title: str,
    magazine_title: str,
    authors: list[str],
    pages: dict,
    content_blocks: list[dict],
) -> str:
    lines = [f"# {article_title}", ""]
    lines.append(f"> Quelle: {magazine_title}, Seiten {pages['start']}-{pages['end']}")
    if authors:
        lines.append(f"> Autor:innen: {', '.join(authors)}")

    for block in content_blocks:
        block_markdown = normalize_ocr_markdown(block.get("markdown", ""))
        if not block_markdown:
            continue
        lines.extend(
            [
                "",
                f"## Seite {block['pageNumber']}",
                "",
                block_markdown,
            ]
        )

    return "\n".join(lines).strip() + "\n"


def build_article_definitions_from_sections(section_candidates: list[dict]) -> list[dict]:
    article_definitions: list[dict] = []
    for section in section_candidates:
        title = normalize_title_text(section.get("title") or "") or infer_section_title(section.get("text") or "")
        if not title:
            continue
        article_definitions.append(
            {
                "title": title,
                "startPage": section["pageNumber"],
                "endPage": section["pageNumber"],
                "entryIds": [section["id"]],
                "authors": [],
                "tags": [section["kind"]] if section.get("kind") else [],
            }
        )
    return article_definitions


def detect_article_ranges(page_infos: list[dict], magazine_title: str) -> list[dict]:
    sizes = [block["size"] for page in page_infos for block in page["blocks"]]
    median_size = statistics.median(sizes) if sizes else 12.0

    for page in page_infos:
        native_title = find_title_candidate(page["blocks"], page["height"], median_size)
        markdown_title = find_markdown_title_candidate(page.get("ocrMarkdown", ""), page.get("text", ""))
        page["title_candidate_native"] = native_title
        page["title_candidate_markdown"] = markdown_title
        if markdown_title and (not native_title or markdown_title["score"] >= native_title["score"]):
            page["title_candidate"] = markdown_title
        else:
            page["title_candidate"] = native_title

    starts: list[int] = []
    for index, page in enumerate(page_infos):
        title = page.get("title_candidate")
        if not title:
            continue

        page_text = page["text"]
        if is_table_of_contents(page_text):
            continue

        ratio = float(title.get("size", median_size)) / max(median_size, 1.0)
        top = title.get("bbox", [0, 0, 0, 0])[1]
        enough_text = len(page_text) > 250
        title_near_top = top < page["height"] * 0.35 if "bbox" in title else True
        heading_count = len(page.get("ocrHeadings", []))
        paragraph_count = len([paragraph for paragraph in page_to_paragraphs(page_text) if len(paragraph) > 80])
        markdown_candidate = page.get("title_candidate_markdown")
        teaser_like = heading_count >= 3 and page.get("shortLineRatio", 0.0) >= 0.55

        native_start = ratio >= 1.75 and title_near_top and enough_text and paragraph_count >= 2 and not teaser_like
        markdown_start = bool(markdown_candidate) and enough_text and paragraph_count >= 2 and heading_count <= 4 and not teaser_like
        if native_start or markdown_start:
            starts.append(index)

    starts = sorted(set(starts))
    if not starts:
        starts = [0]
    elif starts[0] != 0 and len(page_infos[0]["text"]) > 300 and not is_table_of_contents(page_infos[0]["text"]):
        starts.insert(0, 0)

    ranges: list[dict] = []
    for offset, start in enumerate(starts):
        end = starts[offset + 1] - 1 if offset + 1 < len(starts) else len(page_infos) - 1
        title = (page_infos[start].get("title_candidate") or {}).get("text") or f"{magazine_title} Artikel {offset + 1}"
        ranges.append(
            {
                "title": title,
                "startPage": start + 1,
                "endPage": end + 1,
                "authors": [],
                "tags": [],
            }
        )

    return ranges


def ai_segment_issue(
    pdf_slug: str,
    magazine_title: str,
    page_infos: list[dict],
    section_candidates: list[dict],
    output_dir: Path,
) -> list[dict]:
    if not (AI_SEGMENTATION_ENABLED and OPENROUTER_API_KEY and section_candidates):
        return []

    cache_dir = output_dir / "ai" / pdf_slug
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / "issue-segmentation.json"
    if cache_path.exists() and not AI_REFRESH:
        cached = safe_json_load(cache_path)
        if isinstance(cached, dict) and isinstance(cached.get("articles"), list):
            return cached["articles"]

    page_payload = [
        {
            "page": page["pageNumber"],
            "spread": (page.get("sections") or [{}])[0].get("spreadPages", spread_for_page(page["pageNumber"], len(page_infos))),
            "headings": [heading["text"] for heading in page.get("ocrHeadings", [])[:6]],
            "sample": text_excerpt(page.get("text", ""), 220),
        }
        for page in page_infos
    ]
    section_payload = [
        {
            "id": section["id"],
            "page": section["pageNumber"],
            "spread": section["spreadPages"],
            "title": section["title"],
            "wordCount": section["wordCount"],
            "sample": section["sample"],
            "source": section.get("source", "ocr"),
            "kind": section.get("kind"),
        }
        for section in section_candidates
    ]

    system_prompt = """
You segment magazine OCR into true standalone articles.
Return strict JSON only.
Rules:
- Think in spreads and neighboring pages, not isolated pages.
- Distinguish true articles from cover teasers, table of contents, ads, masthead, event listings, pure calendars, photo-only pages, and colophon.
- If one page contains multiple distinct titled pieces, split them into separate articles.
- If a page is a continuation of a previous article, attach it to that article even without a repeated heading.
- Preserve order.
- Be conservative: do not invent text or titles.
JSON schema:
{
  "articles": [
    {
      "title": "string",
      "entryIds": ["p004s01", "p005s02"],
      "authors": [],
      "tags": ["optional", "rubric"]
    }
  ]
}
"""
    user_prompt = (
        f"Magazine: {magazine_title}\n"
        f"PDF slug: {pdf_slug}\n\n"
        "Pages:\n"
        f"{json.dumps(page_payload, ensure_ascii=False, indent=2)}\n\n"
        "Section candidates:\n"
        f"{json.dumps(section_payload, ensure_ascii=False, indent=2)}\n"
    )

    try:
        payload = call_editorial_model(system_prompt, user_prompt)
    except Exception:
        return []

    if not isinstance(payload, dict) or not isinstance(payload.get("articles"), list):
        return []

    section_index = {section["id"]: section for section in section_candidates}
    normalized_articles: list[dict] = []
    used_entry_ids: set[str] = set()

    for article in payload["articles"]:
        if not isinstance(article, dict):
            continue

        title = normalize_whitespace(article.get("title", ""))
        raw_entry_ids = article.get("entryIds") or []
        entry_ids = [entry_id for entry_id in raw_entry_ids if entry_id in section_index and entry_id not in used_entry_ids]
        if not title or not entry_ids:
            continue

        for entry_id in entry_ids:
            used_entry_ids.add(entry_id)

        pages = sorted({section_index[entry_id]["pageNumber"] for entry_id in entry_ids})
        article_text = "\n\n".join(section_index[entry_id]["text"] for entry_id in entry_ids if section_index[entry_id].get("text"))
        if word_count(article_text) < 8:
            continue
        if looks_like_ad_or_structure_title(title, magazine_title) and (max(pages) <= 5 or min(pages) >= max(1, len(page_infos) - 2)):
            continue

        normalized_articles.append(
            {
                "title": html.unescape(title),
                "startPage": min(pages),
                "endPage": max(pages),
                "entryIds": entry_ids,
                "authors": article.get("authors") or [],
                "tags": article.get("tags") or [],
            }
        )

    normalized_articles.sort(key=lambda entry: (entry["startPage"], entry["endPage"], entry["title"].lower()))
    cache_path.write_text(json.dumps({"articles": normalized_articles}, ensure_ascii=False, indent=2), encoding="utf-8")
    return normalized_articles


def demote_markdown_headings(markdown: str, amount: int = 1) -> str:
    lines: list[str] = []
    for line in str(markdown or "").splitlines():
        match = re.match(r"^(#{1,6})\s+(.*)$", line)
        if not match:
            lines.append(line)
            continue

        level = min(6, len(match.group(1)) + amount)
        lines.append(f"{'#' * level} {match.group(2)}")

    return "\n".join(lines).strip()


def build_article_blocks_from_sections(sections: list[dict], page_images: list[dict] | None = None) -> list[dict]:
    image_by_page = {entry["pageNumber"]: entry for entry in (page_images or [])}
    blocks_by_page: dict[int, list[dict]] = defaultdict(list)
    for section in sections:
        blocks_by_page[section["pageNumber"]].append(section)

    content_blocks: list[dict] = []
    for page_number in sorted(blocks_by_page):
        page_sections = blocks_by_page[page_number]
        joined_markdown = "\n\n".join(
            demote_markdown_headings(section["markdown"], 1) for section in page_sections if section.get("markdown")
        ).strip()
        joined_text = "\n\n".join(section["text"] for section in page_sections if section.get("text")).strip()
        content_blocks.append(
            {
                "pageNumber": page_number,
                "spreadPages": page_sections[0].get("spreadPages", [page_number]),
                "sectionIds": [section["id"] for section in page_sections],
                "titles": [section["title"] for section in page_sections if section.get("title")],
                "markdown": joined_markdown,
                "text": joined_text,
                "pageImage": image_by_page.get(page_number),
            }
        )

    return content_blocks


def should_run_editorial_cleanup(article_title: str, content_blocks: list[dict]) -> bool:
    combined_text = "\n\n".join(block.get("text", "") for block in content_blocks)
    if word_count(combined_text) >= 140:
        return True
    if len(content_blocks) >= 2 and word_count(combined_text) >= 80:
        return True
    if len(normalize_whitespace(article_title)) >= 18 and word_count(combined_text) >= 60:
        return True
    return False


def refine_article_blocks_with_ai(
    pdf_slug: str,
    article_slug: str,
    article_title: str,
    magazine_title: str,
    content_blocks: list[dict],
    output_dir: Path,
) -> dict | None:
    if not (AI_EDITORIAL_ENABLED and OPENROUTER_API_KEY and content_blocks):
        return None
    if not should_run_editorial_cleanup(article_title, content_blocks):
        return None

    cache_dir = output_dir / "ai" / pdf_slug / "articles"
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{article_slug}.json"
    if cache_path.exists() and not AI_REFRESH:
        cached = safe_json_load(cache_path)
        if isinstance(cached, dict) and isinstance(cached.get("blocks"), list):
            return cached

    prompt_blocks = [
        {
            "pageNumber": block["pageNumber"],
            "spreadPages": block.get("spreadPages", [block["pageNumber"]]),
            "titles": block.get("titles", []),
            "markdown": block.get("markdown", ""),
        }
        for block in content_blocks
    ]
    system_prompt = """
You are cleaning OCR for a public magazine archive.
Return strict JSON only.
Rules:
- Keep page order.
- Preserve the original meaning and facts.
- Fix only obvious OCR and formatting errors when highly confident.
- Remove page furniture, rubric labels, stray ad fragments, and obvious OCR garbage that does not belong to the article.
- Do not invent missing paragraphs.
- Keep headings and structure in Markdown.
JSON schema:
{
  "title": "string",
  "summary": "string",
  "blocks": [
    {
      "pageNumber": 10,
      "markdown": "## Clean heading\\n\\nClean paragraph text..."
    }
  ]
}
"""
    user_prompt = (
        f"Magazine: {magazine_title}\n"
        f"Article title: {article_title}\n\n"
        "Raw blocks:\n"
        f"{json.dumps(prompt_blocks, ensure_ascii=False, indent=2)}\n"
    )

    try:
        payload = call_editorial_model(system_prompt, user_prompt)
    except Exception:
        return None

    if not isinstance(payload, dict) or not isinstance(payload.get("blocks"), list):
        return None

    cleaned_blocks = []
    block_index = {block["pageNumber"]: block for block in content_blocks}
    for cleaned in payload["blocks"]:
        if not isinstance(cleaned, dict):
            continue
        page_number = int(cleaned.get("pageNumber", 0) or 0)
        source_block = block_index.get(page_number)
        if not source_block:
            continue
        markdown = normalize_ocr_markdown(str(cleaned.get("markdown", "")))
        if not markdown:
            markdown = source_block["markdown"]
        cleaned_blocks.append(
            {
                **source_block,
                "markdown": demote_markdown_headings(markdown, 0),
                "text": markdown_to_plaintext(markdown),
            }
        )

    if not cleaned_blocks:
        return None

    cleaned_blocks.sort(key=lambda entry: entry["pageNumber"])
    result = {
        "title": normalize_whitespace(payload.get("title") or article_title),
        "summary": normalize_whitespace(payload.get("summary") or ""),
        "blocks": cleaned_blocks,
    }
    cache_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    return result


def load_manifest(manifest_dir: Path, pdf_slug: str) -> dict | None:
    manifest_path = manifest_dir / f"{pdf_slug}.json"
    if not manifest_path.exists():
        return None

    return json.loads(manifest_path.read_text(encoding="utf-8"))


def build_page_infos(document, pdf_path: Path, output_dir: Path, pdf_slug: str) -> list[dict]:
    page_infos: list[dict] = []

    for index in range(document.page_count):
        page = document.load_page(index)
        native_text, blocks = extract_blocks(page)
        text = native_text
        ocr_markdown = ""
        ocr_images: list[str] = []
        ocr_source = "native"
        ocr_raw_file = None

        if OCR_PROVIDER == "openrouter-page":
            ocr_result = run_openrouter_page_ocr(document, pdf_path.name, pdf_slug, index, output_dir)
            if normalize_whitespace(ocr_result["text"]):
                text = ocr_result["text"]
                ocr_markdown = ocr_result["markdown"]
                ocr_images = ocr_result["images"]
                ocr_source = ocr_result["provider"]
                ocr_raw_file = ocr_result["rawFile"]
        elif OCR_ENABLED and len(normalize_whitespace(text)) < 80:
            ocr_text = run_tesseract(page)
            if len(normalize_whitespace(ocr_text)) > len(normalize_whitespace(text)):
                text = ocr_text
                ocr_source = "tesseract"

        ocr_headings = extract_markdown_headings(ocr_markdown)
        line_metrics = analyze_text_lines(text)
        layout_payload = run_tesseract_layout(page, pdf_slug, index + 1, output_dir)

        page_infos.append(
            {
                "pageNumber": index + 1,
                "text": text,
                "nativeText": native_text,
                "blocks": blocks,
                "width": float(page.rect.width),
                "height": float(page.rect.height),
                "ocrMarkdown": ocr_markdown,
                "ocrImages": ocr_images,
                "ocrHeadings": ocr_headings,
                "ocrSource": ocr_source,
                "ocrRawFile": ocr_raw_file,
                "lineCount": line_metrics["lineCount"],
                "shortLineRatio": line_metrics["shortLineRatio"],
                "layoutImageFile": layout_payload.get("imageFile"),
                "layoutLines": layout_payload.get("lines", []),
            }
        )

    return page_infos


def save_preview(document, start_page: int, preview_path: Path) -> None:
    page = document.load_page(start_page - 1)
    pixmap = page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
    pixmap.save(preview_path.as_posix())


def export_page_images(document, article_slug: str, start_page: int, end_page: int, output_dir: Path) -> list[dict]:
    page_images: list[dict] = []
    article_dir = output_dir / "page-images" / article_slug
    article_dir.mkdir(parents=True, exist_ok=True)

    for page_number in range(start_page, end_page + 1):
        page = document.load_page(page_number - 1)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(PAGE_IMAGE_SCALE, PAGE_IMAGE_SCALE), alpha=False)
        filename = f"page-{page_number:03d}.jpg"
        output_path = article_dir / filename
        pixmap.save(output_path.as_posix(), jpg_quality=PAGE_IMAGE_QUALITY)
        page_images.append(
            {
                "pageNumber": page_number,
                "image": f"page-images/{article_slug}/{filename}",
                "width": pixmap.width,
                "height": pixmap.height,
            }
        )

    return page_images


def article_payload(
    *,
    article_slug: str,
    article_title: str,
    magazine_slug: str,
    magazine_title: str,
    publication_date: str | None,
    source_pdf: str,
    authors: list[str],
    tags: list[str],
    pages: dict,
    body_text: str,
    preview_file: str | None,
    page_images: list[dict],
    page_details: list[dict],
    content_blocks: list[dict],
    article_markdown: str | None = None,
    article_summary: str | None = None,
) -> tuple[dict, dict]:
    summary = normalize_whitespace(article_summary or "") or sentence_summary(body_text)
    markdown = article_markdown or build_markdown(article_title, magazine_title, authors, pages, body_text)
    full_payload = {
        "slug": article_slug,
        "title": article_title,
        "magazineSlug": magazine_slug,
        "magazineTitle": magazine_title,
        "publicationDate": publication_date,
        "sourcePdf": source_pdf,
        "authors": authors,
        "tags": tags,
        "pages": pages,
        "summary": summary,
        "excerpt": text_excerpt(body_text),
        "wordCount": word_count(body_text),
        "bodyText": body_text,
        "markdown": markdown,
        "previewImage": preview_file,
        "pageImages": page_images,
        "pageDetails": page_details,
        "contentBlocks": content_blocks,
        "contentHash": sha256(markdown),
    }
    index_payload = {
        "slug": article_slug,
        "title": article_title,
        "magazineSlug": magazine_slug,
        "magazineTitle": magazine_title,
        "publicationDate": publication_date,
        "sourcePdf": source_pdf,
        "authors": authors,
        "tags": tags,
        "pages": pages,
        "summary": summary,
        "excerpt": text_excerpt(body_text),
        "wordCount": full_payload["wordCount"],
        "previewImage": preview_file,
        "pageImageCount": len(page_images),
        "contentHash": full_payload["contentHash"],
        "bodyText": body_text,
        "file": f"articles/{article_slug}.json",
    }
    return full_payload, index_payload


def process_pdf(pdf_path: Path, manifest_dir: Path, output_dir: Path) -> tuple[dict, list[dict]]:
    document = fitz.open(pdf_path.as_posix())
    pdf_slug = slugify(pdf_path.stem)
    manifest = load_manifest(manifest_dir, pdf_slug)
    metadata = document.metadata or {}
    magazine_title = (
        manifest.get("magazine", {}).get("title")
        if manifest
        else metadata.get("title")
    ) or pdf_path.stem
    magazine_slug = (
        manifest.get("magazine", {}).get("slug")
        if manifest
        else None
    ) or pdf_slug
    publication_date = manifest.get("magazine", {}).get("publicationDate") if manifest else None
    page_infos = build_page_infos(document, pdf_path, output_dir, pdf_slug)
    section_candidates = build_issue_section_candidates(
        page_infos,
        document.page_count,
        magazine_title,
        pdf_slug,
        output_dir,
    )
    section_index = {section["id"]: section for section in section_candidates}

    if manifest and manifest.get("articles"):
        article_definitions = manifest["articles"]
    else:
        article_definitions = ai_segment_issue(pdf_slug, magazine_title, page_infos, section_candidates, output_dir)
        if not article_definitions:
            article_definitions = build_article_definitions_from_sections(section_candidates)
        if not article_definitions:
            article_definitions = detect_article_ranges(page_infos, magazine_title)
        draft_manifest = {
            "magazine": {
                "title": magazine_title,
                "slug": magazine_slug,
                "publicationDate": publication_date,
            },
            "articles": article_definitions,
        }
        draft_path = output_dir / "drafts" / f"{pdf_slug}.json"
        draft_path.write_text(json.dumps(draft_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    used_slugs: set[str] = set()
    article_index_entries: list[dict] = []
    magazine_articles: list[dict] = []

    for position, definition in enumerate(article_definitions, start=1):
        start_page = max(1, int(definition["startPage"]))
        end_page = min(document.page_count, int(definition["endPage"]))
        if end_page < start_page:
            start_page, end_page = end_page, start_page

        body_pages = page_infos[start_page - 1 : end_page]
        page_details = []
        article_sections = []
        if definition.get("entryIds"):
            article_sections = [section_index[entry_id] for entry_id in definition["entryIds"] if entry_id in section_index]
        else:
            for page in body_pages:
                article_sections.extend(page.get("sections", []))

        if not article_sections:
            for page in body_pages:
                fallback_markdown = normalize_ocr_markdown(page.get("ocrMarkdown") or page.get("text") or "")
                if not fallback_markdown:
                    continue
                article_sections.append(
                    {
                        "id": f"p{page['pageNumber']:03d}s01",
                        "pageNumber": page["pageNumber"],
                        "spreadPages": spread_for_page(page["pageNumber"], document.page_count),
                        "title": None,
                        "markdown": fallback_markdown,
                        "text": markdown_to_plaintext(fallback_markdown),
                        "wordCount": word_count(markdown_to_plaintext(fallback_markdown)),
                        "sample": text_excerpt(markdown_to_plaintext(fallback_markdown), 220),
                        "hasHeading": False,
                    }
                )

        article_title = definition.get("title") or f"{magazine_title} Artikel {position}"
        provisional_slug = slugify(definition.get("slug") or article_title or f"article-{position}")
        authors = definition.get("authors") or []
        tags = definition.get("tags") or []
        pages = {
            "start": start_page,
            "end": end_page,
        }

        provisional_blocks = build_article_blocks_from_sections(article_sections)
        editorial_result = refine_article_blocks_with_ai(
            pdf_slug=pdf_slug,
            article_slug=provisional_slug,
            article_title=article_title,
            magazine_title=magazine_title,
            content_blocks=provisional_blocks,
            output_dir=output_dir,
        )
        if editorial_result:
            article_title = editorial_result.get("title") or article_title
            article_summary = editorial_result.get("summary") or None
            provisional_blocks = editorial_result["blocks"]
        else:
            article_summary = None

        article_slug = unique_slug(definition.get("slug") or article_title, used_slugs)

        preview_file = f"previews/{article_slug}.png"
        preview_path = output_dir / preview_file
        save_preview(document, start_page, preview_path)
        page_images = (
            export_page_images(document, article_slug, start_page, end_page, output_dir)
            if PAGE_IMAGE_ENABLED
            else []
        )
        final_blocks = build_article_blocks_from_sections(article_sections, page_images)
        if editorial_result:
            cleaned_by_page = {block["pageNumber"]: block for block in editorial_result["blocks"]}
            patched_blocks = []
            for block in final_blocks:
                cleaned = cleaned_by_page.get(block["pageNumber"])
                if not cleaned:
                    patched_blocks.append(block)
                    continue
                patched_blocks.append(
                    {
                        **block,
                        "markdown": cleaned.get("markdown", block["markdown"]),
                        "text": cleaned.get("text", block["text"]),
                    }
                )
            final_blocks = patched_blocks

        body_text = "\n\n".join(block["text"] for block in final_blocks if block.get("text")).strip()
        article_markdown = build_article_markdown_from_blocks(article_title, magazine_title, authors, pages, final_blocks)

        blocks_by_page = {block["pageNumber"]: block for block in final_blocks}
        for page in body_pages:
            block = blocks_by_page.get(page["pageNumber"])
            page_details.append(
                {
                    "pageNumber": page["pageNumber"],
                    "text": block.get("text") if block else page["text"],
                    "nativeText": page.get("nativeText", ""),
                    "ocrMarkdown": page.get("ocrMarkdown", ""),
                    "ocrSource": page.get("ocrSource", "native"),
                    "ocrImageCount": len(page.get("ocrImages", [])),
                    "ocrRawFile": page.get("ocrRawFile"),
                    "displayMarkdown": block.get("markdown") if block else normalize_ocr_markdown(page.get("ocrMarkdown", "")),
                    "sectionIds": block.get("sectionIds", []) if block else [],
                    "titles": block.get("titles", []) if block else [],
                }
            )

        full_payload, index_payload = article_payload(
            article_slug=article_slug,
            article_title=article_title,
            magazine_slug=magazine_slug,
            magazine_title=magazine_title,
            publication_date=publication_date,
            source_pdf=pdf_path.name,
            authors=authors,
            tags=tags,
            pages=pages,
            body_text=body_text,
            preview_file=preview_file,
            page_images=page_images,
            page_details=page_details,
            content_blocks=final_blocks,
            article_markdown=article_markdown,
            article_summary=article_summary,
        )

        article_output_path = output_dir / index_payload["file"]
        article_output_path.write_text(json.dumps(full_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        article_index_entries.append(index_payload)
        magazine_articles.append(
            {
                "slug": article_slug,
                "title": article_title,
                "pages": pages,
                "authors": authors,
                "summary": full_payload["summary"],
            }
        )

    magazine_payload = {
        "slug": magazine_slug,
        "title": magazine_title,
        "publicationDate": publication_date,
        "sourcePdf": pdf_path.name,
        "pageCount": document.page_count,
        "articleCount": len(magazine_articles),
        "articles": magazine_articles,
        "file": f"magazines/{magazine_slug}.json",
    }

    magazine_output_path = output_dir / magazine_payload["file"]
    magazine_output_path.write_text(json.dumps(magazine_payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return magazine_payload, article_index_entries


def clear_generated_output(output_dir: Path) -> None:
    for relative in ("articles", "magazines", "previews", "drafts", "page-images"):
        target_dir = output_dir / relative
        if not target_dir.exists():
            continue

        for child in target_dir.iterdir():
            if child.name == ".gitkeep":
                continue
            if child.is_dir():
                shutil.rmtree(child)
            elif child.is_file() or child.is_symlink():
                child.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract Proud magazine PDFs into a searchable local archive.")
    parser.add_argument("--site-config", required=True)
    parser.add_argument("--input-dir", required=True)
    parser.add_argument("--manifest-dir", required=True)
    parser.add_argument("--output-dir", required=True)
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    manifest_dir = Path(args.manifest_dir)
    output_dir = Path(args.output_dir)

    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "articles").mkdir(parents=True, exist_ok=True)
    (output_dir / "magazines").mkdir(parents=True, exist_ok=True)
    (output_dir / "previews").mkdir(parents=True, exist_ok=True)
    (output_dir / "drafts").mkdir(parents=True, exist_ok=True)
    (output_dir / "page-images").mkdir(parents=True, exist_ok=True)
    (output_dir / "ocr").mkdir(parents=True, exist_ok=True)
    clear_generated_output(output_dir)

    with open(args.site_config, "r", encoding="utf-8") as handle:
        site_config = json.load(handle)

    if OCR_PROVIDER == "openrouter-page" and not OPENROUTER_API_KEY:
        raise SystemExit("OPENROUTER_API_KEY fehlt für PROUD_OCR_PROVIDER=openrouter-page.")

    pdf_files = sorted(input_dir.glob("*.pdf"))
    if not pdf_files:
        print(f"Keine PDFs gefunden in {input_dir}")
        library = {
            "schemaVersion": 1,
            "site": {
                "title": site_config["siteTitle"],
                "domain": site_config["domain"],
                "description": site_config["description"],
                "language": site_config.get("language", "de"),
            },
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "magazines": [],
            "articles": [],
            "stats": {
                "magazineCount": 0,
                "articleCount": 0,
                "wordCount": 0,
            },
        }
        (output_dir / "library.json").write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
        return

    magazines: list[dict] = []
    articles: list[dict] = []
    failures: list[dict] = []

    print(
        f"Starte Ingest für {len(pdf_files)} PDFs"
        + (
            f" mit OCR-Provider {OCR_PROVIDER}."
            if OCR_PROVIDER != "native"
            else (" mit OCR-Fallback." if OCR_ENABLED else " ohne OCR-Fallback.")
        ),
        flush=True,
    )

    for index, pdf_path in enumerate(pdf_files, start=1):
        print(f"[{index}/{len(pdf_files)}] Verarbeite {pdf_path.name}", flush=True)
        try:
            magazine_payload, article_entries = process_pdf(pdf_path, manifest_dir, output_dir)
        except Exception as error:
            failures.append(
                {
                    "pdf": pdf_path.name,
                    "error": str(error),
                }
            )
            print(f"Fehler bei {pdf_path.name}: {error}", flush=True)
            continue

        magazines.append(magazine_payload)
        articles.extend(article_entries)
        print(
            f"[{index}/{len(pdf_files)}] Fertig: {magazine_payload['title']} "
            f"({magazine_payload['articleCount']} Artikel, {magazine_payload['pageCount']} Seiten)",
            flush=True,
        )

    library = {
        "schemaVersion": 1,
        "site": {
            "title": site_config["siteTitle"],
            "domain": site_config["domain"],
            "description": site_config["description"],
            "language": site_config.get("language", "de"),
        },
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "magazines": magazines,
        "articles": articles,
        "failures": failures,
        "stats": {
            "magazineCount": len(magazines),
            "articleCount": len(articles),
            "wordCount": sum(article["wordCount"] for article in articles),
            "failedPdfCount": len(failures),
        },
    }

    (output_dir / "library.json").write_text(json.dumps(library, ensure_ascii=False, indent=2), encoding="utf-8")
    print(
        f"Fertig. {len(magazines)} Magazine und {len(articles)} Artikel indexiert."
        + (f" {len(failures)} PDFs mit Fehlern." if failures else ""),
        flush=True,
    )


if __name__ == "__main__":
    main()
