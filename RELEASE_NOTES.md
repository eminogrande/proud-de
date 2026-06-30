# release notes

## 2026-06-30

### Changed

1. Rebuilt the visual system around a DIN-style sans stack, black-on-white page chrome, and black headline labels with white type.
2. Normalized footer typography to the same reading font and size as the body copy.
3. Added build-time WebP optimization for previews and page scans: the generated site now references `.webp` assets instead of heavy PNG/JPG files.
4. Reduced generated public site size from roughly 455 MB to roughly 24 MB by resizing and compressing article preview and page images.
5. Changed repository publishing scope so the generated `site/` export can be committed and deployed directly, while raw PDFs and `data/output` remain local/generated.
1. Reworked archive and issue article lists into compact Medium-like rows with text-first hierarchy, right-side thumbnails, longer excerpts, and fewer visible controls.
2. Reduced visual noise in article lists by hiding duplicate stats, topic chips, and read buttons where the title and image already lead to the article.
3. Simplified issue pages to one chronological contents list instead of mixing curated story grids and word-count rankings.
4. Consolidated typography and secondary article sections into fewer reusable text roles, removing boxed related/source panels and mismatched headline styles.
5. Removed generic archive labels from article teasers and switched headings/kickers to a timeless black-and-white marker style with no green accent color.
6. Tightened mobile issue headers so readers reach the chronological article list faster.

## 2026-06-29

### Changed

1. Refined single article pages toward a Medium-like reading layout: compact header, one-column hero, no scan previews before the text, no visible TL;DR box, and quieter body typography.
2. Tuned article subheadlines to use quieter serif typography and highlighted every visible `proud` word in brand pink `#ec0677`.
3. Moved original page scans back near the article top: two-page articles render side by side, one-page articles render as a single centered scan.
4. Simplified the front page into a cleaner newspaper hierarchy: one lead story, no duplicate focus rail, calmer story teasers, and consistent image crops.
1. Simplified article pages into a quieter, magazine-like reading layout.
2. Moved source context, original issue links, reading text, and page scans to the end of article pages.
3. Removed visible technical archive navigation from the page header.
4. Added a clear language switch near each article headline.
5. Normalized visible issue titles to `proud #01` style instead of raw PDF/export filenames.

### Added

1. Added a deploy checklist for agent readiness, PageSpeed, SEO, GEO, and live endpoint checks.
2. Added a working agreement that captures the product and engineering direction for future sessions.
3. Added a live audit command for core public endpoints.

### Decision

The browser experience should feel like a clean modern magazine, while machine-readable formats stay available through metadata, well-known routes, Markdown, APIs, MCP, robots, and `llms.txt`.
