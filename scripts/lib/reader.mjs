import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { escapeHtml } from "../../src/lib/html.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const READER_JS_PATH = join(HERE, "../../src/reader/reader.js");
export const READER_CSS_PATH = join(HERE, "../../src/reader/reader.css");

export const READER_TEXT = {
  de: {
    pdf: "PDF, {mb} MB",
    pages: "Seiten",
    close: "Schließen",
    previous: "Vorherige Seite",
    next: "Nächste Seite",
    first: "Erste Seite",
    last: "Letzte Seite",
    counterSingle: "Seite {a} von {n}",
    counterPair: "Seiten {a}\u2013{b} von {n}",
    pageAlt: "Seite",
    backToIssue: "Zurück zum Heft",
    jumpToPage: "Zu Seite springen",
    gridTitle: "Seitenübersicht",
    listIntro: "Alle Seiten des Hefts untereinander.",
  },
  en: {
    pdf: "PDF, {mb} MB",
    pages: "Pages",
    close: "Close",
    previous: "Previous page",
    next: "Next page",
    first: "First page",
    last: "Last page",
    counterSingle: "Page {a} of {n}",
    counterPair: "Pages {a}\u2013{b} of {n}",
    pageAlt: "Page",
    backToIssue: "Back to issue",
    jumpToPage: "Jump to page",
    gridTitle: "All pages",
    listIntro: "Every page of this issue in one list.",
  },
};

const SIZES = "(min-width: 900px) 50vw, 100vw";

function text(locale) {
  return READER_TEXT[locale] ?? READER_TEXT.en;
}

function fill(template, values) {
  return template.replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

function pad(n) {
  return String(n).padStart(3, "0");
}

function clampPage(value, pageCount) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) {
    return 1;
  }
  return Math.min(Math.max(n, 1), pageCount);
}

export function renderReaderMain({
  locale,
  manifest,
  assetBase,
  version,
  title,
  dateLabel = null,
  hrefs = {},
  startPage = 1,
} = {}) {
  const t = text(locale);
  const base = String(assetBase ?? "").replace(/\/$/, "");
  const v = String(version ?? "");
  const label = String(title ?? manifest?.title ?? "");
  const web = manifest?.web ?? {};
  const pagesInfo = Array.isArray(manifest?.pagesInfo) ? manifest.pagesInfo : [];
  const pageCount = pagesInfo.length || Number(manifest?.pages) || 1;
  const start = clampPage(startPage, pageCount);
  const url = (page, variant) => `${base}/pages/${pad(page)}-${variant}.webp?v=${v}`;
  const pdfUrl = `${base}/${web.pdf}?download=1&v=${v}`;
  const mb = Math.max(1, Math.round(Number(web.bytes ?? 0) / 1048576));

  const list = pagesInfo.map((page) => {
    const alt = `${label}, ${t.pageAlt} ${page.n}`;
    return (
      `<li><a href="${escapeHtml(url(page.n, "l"))}">` +
      `<img loading="lazy" decoding="async" src="${escapeHtml(url(page.n, "m"))}" ` +
      `srcset="${escapeHtml(url(page.n, "m"))} 900w, ${escapeHtml(url(page.n, "l"))} 1800w" ` +
      `sizes="${SIZES}" width="${escapeHtml(page.w)}" height="${escapeHtml(page.h)}" ` +
      `alt="${escapeHtml(alt)}"></a></li>`
    );
  });

  const grid = pagesInfo.map(
    (page) =>
      `<li><button type="button" data-page="${page.n}" aria-label="${escapeHtml(`${label}, ${t.pageAlt} ${page.n}`)}">` +
      `<img loading="lazy" decoding="async" src="${escapeHtml(url(page.n, "s"))}" ` +
      `width="${escapeHtml(page.w)}" height="${escapeHtml(page.h)}" alt=""></button></li>`,
  );

  return `<section class="reader" data-page-count="${pageCount}" data-start-page="${start}" data-asset-base="${escapeHtml(base)}" data-version="${escapeHtml(v)}" data-title="${escapeHtml(label)}" data-page-alt="${escapeHtml(t.pageAlt)}" data-counter-single="${escapeHtml(t.counterSingle)}" data-counter-pair="${escapeHtml(t.counterPair)}">
  <header class="reader-head">
    ${dateLabel ? `<p class="reader-kicker">${escapeHtml(dateLabel)}</p>` : ""}
    <h1 class="label-title"><span class="label">${escapeHtml(label)}</span></h1>
    <div class="reader-toolbar">
      <a class="reader-back" href="${escapeHtml(hrefs.issue ?? "")}">${escapeHtml(t.backToIssue)}</a>
      <button type="button" class="reader-grid-open" aria-haspopup="dialog" aria-controls="reader-grid">${escapeHtml(t.pages)}</button>
      <a class="reader-pdf" href="${escapeHtml(pdfUrl)}" download>${escapeHtml(fill(t.pdf, { mb }))}</a>
    </div>
  </header>
  <div class="reader-stage">
    <button type="button" class="reader-prev" aria-label="${escapeHtml(t.previous)}"><span aria-hidden="true">\u2039</span></button>
    <div class="reader-spread" aria-live="off"></div>
    <button type="button" class="reader-next" aria-label="${escapeHtml(t.next)}"><span aria-hidden="true">\u203a</span></button>
  </div>
  <p class="reader-counter" aria-live="polite"></p>
  <div class="reader-controls">
    <button type="button" class="reader-first" aria-label="${escapeHtml(t.first)}"><span aria-hidden="true">\u00ab</span></button>
    <input type="range" class="reader-slider" min="1" max="${pageCount}" step="1" value="${start}" aria-label="${escapeHtml(t.jumpToPage)}">
    <button type="button" class="reader-last" aria-label="${escapeHtml(t.last)}"><span aria-hidden="true">\u00bb</span></button>
  </div>
  <dialog class="reader-grid" id="reader-grid" aria-labelledby="reader-grid-title">
    <div class="reader-grid-head">
      <h2 class="label-heading" id="reader-grid-title"><span class="label">${escapeHtml(t.gridTitle)}</span></h2>
      <button type="button" class="reader-grid-close" aria-label="${escapeHtml(t.close)}"><span aria-hidden="true">\u00d7</span></button>
    </div>
    <ol class="reader-grid-list">${grid.join("")}</ol>
  </dialog>
  <p class="reader-list-intro">${escapeHtml(t.listIntro)}</p>
  <ol class="reader-pages">${list.join("")}</ol>
</section>`;
}
