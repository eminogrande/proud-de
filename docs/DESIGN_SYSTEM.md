# Design system: proud magazine Berlin (archive edition)

Design v2 (October 2026). Model: the owner's own site (emin.de preview): warm paper, a quiet text-only top bar, generous whitespace, a narrow reading column, a centered article header and big cover cards in sections. The proud CI stays: the real pink ambigram logo, black label headings (Barlow bold, white on black), pink rubric kickers. Nothing dark, no newspaper furniture (no double rules, no letter-spaced caps nav, no boxed buttons).

```mermaid
flowchart TD
  CR[data/input/credits/*.json<br/>printed credits + masthead] --> ED[scripts/lib/editorial.mjs<br/>people registry, bylines, page copy]
  FA[data/input/facts.json<br/>verified + self-reported facts] --> ED
  CF[config/contact.json<br/>config/legal.json] --> ED
  LOGO[src/brand/proud-logo.svg<br/>ambigram, #ed0677] --> BS
  ED --> BS[scripts/build-site.mjs<br/>CSS + DESIGN_V2_CSS layer]
  BS --> H[Header: logo turns 180° on hover/focus/tap<br/>quiet nav + language pill]
  BS --> HOME[Home: intro · Latest band · one section per rubric · More list]
  BS --> A[Article: centered head on paper<br/>hero + scans + text on the band<br/>related cover cards]
  BS --> R[Rubric pages /rubrics/slug/]
  BS --> P[Author, About, Masthead, Press, ...]
  BS --> J[JSON-LD, llms.txt, sitemap,<br/>Markdown twins]
```

## Tokens

| Token | Value | Use |
|---|---|---|
| `--bg` / `--paper` | `#fdf6e3` | Page (warm paper). Never dark. |
| `--band` | `#eee8d5` | Alt band: home "Latest", article body, related stories |
| `--ink` | `#073642` | Body text (12.0:1 on paper) |
| `--head` | `#002b36` | Card titles, nav, footer links |
| `--label-bg` | `#1a1713` | Black label headings (white text) |
| `--muted` | `#4f646b` | Kicker issue, datelines, captions (5.1:1 on band) |
| `--line` | `#e4dfcf` | Hairlines (footer, More list) |
| `--link` | `#1a669c` | Links, subtle underline (5.0:1 on band) |
| `--logo-pink` | `#ed0677` | Logo, focus ring, active nav underline, quote rule. Not for text (3.5:1). |
| `--proud-pink` | `#b8004f` | Rubric kicker, link hover, the word "proud" in text (5.4:1 on band) |
| `--radius` | `12px` | Images, cover cards, hero, scans |
| Label headings | Barlow 700, `--size-label-title` clamp(2.2rem, 5.5vw, 3.6rem), `--size-label-h2` clamp(1.6rem, 3vw, 2.1rem) | Page titles (H1), section heads, question headings in articles |
| Card titles | Barlow 700, plain `--head` colour | Cover cards (no label box) |
| Body | Inter, `--size-body` 21.6–24px | Reading text. Do not shrink. |
| Meta | 17–18px | Minimum text size on the site (17px floor) |

Black label heading: `<h1 class="label-title"><span class="label">…</span></h1>`. The span is `display:inline` with `box-decoration-break: clone`, so every wrapped line gets its own black box. Article body H2/H3 and prose H2 get the span via `labelHeadings()`.

## Logo

- File: `src/brand/proud-logo.svg`, one path, fill `#ed0677`, viewBox cropped to the glyphs (`116 184 2330 1073`), `<title>proud</title>`, `role="img"`. Built copies: `/assets/proud-logo.svg` (SVG favicon), `/assets/logo.png` (512×512 transparent, padded square; apple-touch-icon), `/assets/logo-1200.png` (1200×553, schema.org `logo`), `/favicon.ico` (16/32/48).
- Inline in header (116px wide, 84px under 760px) and footer (92px), inside the home link `aria-label="proud magazine Berlin home"` (`… Startseite` in German). The inline SVG is `aria-hidden` because the link carries the name.
- It is an ambigram: rotated 180° it still reads "proud". Hover, keyboard focus and tap (`:hover`, `:focus`, `:active`) turn it 180° with `transform 0.6s cubic-bezier(.65,0,.35,1)`. With `prefers-reduced-motion: reduce` there is no transition and no rotation. Focus ring: 3px `--logo-pink`.
- Never recolour, outline, stretch or put it on a dark ground. Minimum width 84px. No GIF: the rotation is CSS (no Drive animation was clearly better than the vector).

Rules: no autoplay motion (the logo turn is user-triggered only), no particles, no jargon. Tap targets ≥ 44px. No horizontal scroll at 360 and 390 px.

## Page templates

| Template | Order |
|---|---|
| Header (all pages) | Logo (left) · text nav Artikel, Ausgaben, Autor:innen, Über proud, Redaktion (right; second row under 760px, wraps, never clipped) · language pill |
| Home | Centered intro (kicker, label H1, one sentence + About link) · band "Neu im Archiv / Latest" (lead cover card wide + 5 cover cards, "All articles") · one section per rubric with ≥2 unshown stories (label heading, 3 cover cards, "Mehr <Rubrik>") · "More" list · "All N articles" |
| Cover card | 3:2 cutout (rounded) · kicker (pink rubric + issue) · plain bold title · 3-line deck · printed author or photo credit + month |
| Article | Centered head on paper: kicker (rubric link + `proud #01 · Januar 2009`) · label H1 · "Kurz gesagt:/In short:" + italic deck · byline `Von …` + secondary credits · dateline · pills (Originalseite, Markdown, Deutsch/English) · printed bio note if any. Then on the band: hero with caption + printed photo credit · scans · text (label question headings) · author box · videos. Then related stories as cover cards. |
| Rubric `/rubrics/<slug>/` (de + en) | Kicker · label H1 (rubric as printed, capitalised) · deck · all cover cards of the rubric · All articles. Markdown twin, sitemap with hreflang, llms.txt "Rubrics". |
| Author | Kicker · label H1 name as printed · roles · printed bio (only Moritz Stellmacher has one) · masthead roles · article list · source note |
| Text page | Kicker · label H1 · deck · prose from `staticPageMarkdown()` with label H2s |
| Footer | Logo · About, Masthead, Standards, Press, Archive guide, Corrections (+ Impressum, Datenschutz when configured) · "Herausgeber heute" · DNB trust line |

Images: hero cutouts ship as 1600px plus 800px (`/assets/hero-800/`), scans as 1400px plus 760px (`/assets/page-images-760/`), offered via `srcset`/`sizes`; all immutable-cached.

## Issues, reader, PDF

All 32 issues (00 to 09 and 11 to 32; 10 never existed) have an overview card, an issue page and a reader. Tokens used are the existing ones: `--paper`, `--head`, `--link`, `--line`, `--muted`, `--proud-pink`, `--radius`, `--band`, `--size-meta`, `--size-body`, `--serif-font`. No new tokens, fonts, boxes or badges.

```mermaid
flowchart LR
  M["/magazines/<br/>32 rows: cover, date, pages, Lesen, PDF"] --> I["/magazines/NN/<br/>cover, facts, previous + next issue"]
  I --> R["/magazines/NN/read/<br/>page-by-page reader"]
  I --> A["Articles (issue 01 only, 63)<br/>or one honest sentence"]
  I --> P["/assets/issues/NN/proud-NN.pdf<br/>web PDF, 8 to 39 MB"]
  R --> P
  O["/magazines/01-proud-issuu-output/"] -->|"meta refresh + canonical"| I
  R --> IMG["/assets/issues/NN/pages/PPP-s|m|l.webp<br/>R2 behind the Worker"]
  M --> IMG
```

| Page | Order |
|---|---|
| Overview `/magazines/` (de) and `/en/magazines/` | Label H1 "Ausgaben" / "Issues" · one sentence with the number of issues · two-column list from 900 px, one column below · row = cover (96 to 150 px) · `proud #NN` · month and year when known, else only the page count · `Lesen` (primary) and `PDF, NN,N MB` |
| Issue `/magazines/NN/` | Kicker · label H1 `proud #NN` · date and page count · Lesen, PDF, Markdown · language chips · `Vorherige Ausgabe: proud #NN` and `Nächste Ausgabe: proud #NN` · article list (issue 01) or "Die Artikel dieser Ausgabe werden noch erfasst. Lesen und PDF gibt es schon." |
| Reader `/magazines/NN/read/` | Normal site header · reader section (see `docs/READER.md`) · `--reader-offset` is `7rem` from 900 px and `11rem` below, measured: reader top at 107.5 px (desktop) and 156.8 to 172.8 px (phones), controls end inside the screen at 11 widths from 320 to 1440 |
| Old issue 01 address | Small static page with meta refresh and canonical link to `/magazines/01/` (de and en), plus a Markdown twin |

Dates come from `data/input/issue-dates.json` (`issues` map). 26 of 32 are known (some year only: 00, 20, 22 to 26, 32). Unknown dates are left out, never guessed: 21, 27, 28, 29, 30, 31.

Files: `scripts/lib/issues-site.mjs` (pure renderers, tests in `tests/issues-site.test.mjs`), wiring in `scripts/build-site.mjs`, `reader.css` and `reader.js` copied to `site/assets/` with an 8 character `?v=` hash. The GitHub Pages mirror loads page images and PDFs from the Worker host (`scripts/build-pages.mjs`, `tests/build-pages.test.mjs`).

## Honesty rules (enforced in `tests/editorial.test.mjs` and `scripts/audit-live.mjs`)

- Bylines only from printed credits. No credit means no "Von" line. Low-confidence credits (`zey-break`) never create author pages.
- Image sources (flickr.com, JanAdler.com, domains, brands) are credits, not people.
- No invented bios, photos, titles or social links. Names as printed; alias noted (`Pumpa Peta` / `Peta Pumpa`, `Ron WIlson` / `Ron Wilson`).
- Publisher: "Herausgeber heute: Emin Mahrt" (owner statement 06.10.2026, private person). Issue 01 (2009): "Herausgeber laut Impressum Richard Kirschstein und Emin Henri Mahrt". Never "sole publisher in 2009". No company as current operator.
- DFJV: only the verified 2009 newsletter quote (About, Press), as blockquote + cite, no link (no public copy). Never "recognised", "awarded", "mentioned multiple times".
- Never: 1.5 million, 650,000, awards, ISSN (none exists), founding year as fact (say "first issue January 2009", dummy #00 2008).
- Print run 20,000 only with "nach Angaben der Herausgeber" / "according to the publishers".
- Contact and legal data only from `config/contact.json` and `config/legal.json`. Empty means not shown.
