# Issue 02 Status

Issue `02 proud issuu_output.pdf` is available locally, but it is not ready to publish yet.

## What Was Tried

The normal high-quality path was started with:

```bash
npm run generate -- --input-dir data/input/review-issues-01-02 --translate en --magazine 02-proud-issuu-output
```

The run failed during OpenRouter OCR with:

```text
OpenRouter OCR Fehler (402): Insufficient credits.
```

## Local Fallback Result

A no-credit local fallback was tested with native PDF text and Tesseract OCR. A small decoding bug was fixed so the fallback can complete.

The fallback result was:

- `23` detected articles.
- `68` pages.
- about `5,688` words.

This is not good enough for publication. Several titles were broken and the article segmentation is too weak.

## Decision

Do not publish issue `02` from the local fallback result.

Use the AI/OCR path after OpenRouter credits are available, then review the generated issue before deploying.
