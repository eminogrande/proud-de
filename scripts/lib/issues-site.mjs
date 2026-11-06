// Issue overview, issue pages and reader wiring. Pure string builders, no site state.
// Data comes from the committed manifests (data/input/issues/NN.json) and the issue dates map.
import fs from "node:fs/promises";
import path from "node:path";
import { escapeHtml } from "../../src/lib/html.mjs";

export const ISSUE_TEXT = {
  de: {
    overviewTitle: "Alle Ausgaben",
    overviewIntro: (count) => `Alle ${count} Ausgaben von proud. Blättern, lesen, herunterladen.`,
    page: "Seite",
    coverAlt: (title) => `${title}, Titelseite`,
    read: "Lesen",
    readLabel: (title) => `${title} blättern`,
    pdf: "PDF, {size} MB",
    pdfLabel: (title) => `${title} als PDF herunterladen`,
    pages: (count) => `${count} Seiten`,
    notice: "Die Artikel dieser Ausgabe werden noch erfasst. Lesen und PDF gibt es schon.",
    contents: "Artikel dieser Ausgabe",
    previous: "Vorherige Ausgabe",
    next: "Nächste Ausgabe",
    redirectTitle: "Diese Ausgabe hat eine neue Adresse",
    redirectLead: "Weiter zur Ausgabe:",
    readerTitle: (title) => `${title} blättern`,
    back: "Zurück zur Ausgabe",
  },
  en: {
    overviewTitle: "All issues",
    overviewIntro: (count) => `All ${count} issues of proud. Browse, read, download.`,
    page: "Page",
    coverAlt: (title) => `${title}, cover`,
    read: "Read",
    readLabel: (title) => `Browse ${title}`,
    pdf: "PDF, {size} MB",
    pdfLabel: (title) => `Download ${title} as PDF`,
    pages: (count) => `${count} pages`,
    notice: "The articles in this issue are still being transcribed. Reading and the PDF are already here.",
    contents: "Articles in this issue",
    previous: "Previous issue",
    next: "Next issue",
    redirectTitle: "This issue has a new address",
    redirectLead: "Continue to the issue:",
    readerTitle: (title) => `Browse ${title}`,
    back: "Back to the issue",
  },
};

export function issueText(locale) {
  return ISSUE_TEXT[locale] ?? ISSUE_TEXT.en;
}

// "01-proud-issuu-output" -> "01"; "24" -> "24"; anything else -> null.
export function issueNumberOf(value) {
  const match = String(value ?? "").match(/^(\d{1,3})(?:\b|[-_\s])/);
  return match ? match[1].padStart(2, "0") : null;
}

export function issueTitle(n) {
  return `proud #${n}`;
}

export function formatIssueSize(bytes, locale = "de") {
  const mb = Number(bytes ?? 0) / 1048576;
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(mb);
}

export function formatIssueCount(value, locale = "de") {
  return new Intl.NumberFormat(locale === "en" ? "en-US" : "de-DE").format(Number(value ?? 0));
}

// One entry per manifest, newest issue first. Dates only when known.
export function buildIssueEntries(manifests, dateMap = {}) {
  return manifests
    .map((manifest) => {
      const n = issueNumberOf(manifest?.issue ?? manifest?.title);
      if (!n) return null;
      const cover = Array.isArray(manifest.pagesInfo) ? manifest.pagesInfo[0] : null;
      const web = manifest.web ?? {};
      return {
        n,
        title: issueTitle(n),
        pages: Number(manifest.pages ?? manifest.pagesInfo?.length ?? 0),
        layout: manifest.layout ?? "single",
        date: dateMap[n] ?? null,
        assetBase: `/assets/issues/${n}`,
        pdfName: web.pdf ?? `proud-${n}.pdf`,
        pdfBytes: Number(web.bytes ?? 0),
        version: String(web.sha256 ?? "").slice(0, 8),
        cover: cover ? { w: Number(cover.w), h: Number(cover.h) } : null,
        manifest,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.n.localeCompare(left.n));
}

export async function loadIssueManifests(dir) {
  const names = (await fs.readdir(dir)).filter((name) => /^\d{2}\.json$/.test(name)).sort();
  const manifests = [];
  for (const name of names) {
    manifests.push(JSON.parse(await fs.readFile(path.join(dir, name), "utf8")));
  }
  return manifests;
}

export function issueDateLabel(entry, locale = "de") {
  if (!entry.date) return "";
  const [year, month] = entry.date.split("-");
  if (!month) return year;
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
}

// The web PDFs live in a public GitHub release, because Cloudflare static assets
// are limited to 25 MiB per file and the largest issue is 39 MB. The page images
// ship with the Worker. PROUD_PDF_BASE can point elsewhere (for example the old
// /assets/issues route) without a code change; a relative base keeps the old form.
export const PDF_RELEASE_BASE = "https://github.com/eminogrande/proud-de/releases/download/issues-pdfs-v1";

export function issuePdfBase() {
  return (process.env.PROUD_PDF_BASE ?? PDF_RELEASE_BASE).replace(/\/+$/, "");
}

export function issuePdfPath(entry) {
  const base = issuePdfBase();
  const suffix = base.startsWith("/") ? `?v=${entry.version}` : "";
  return `${base}/${entry.pdfName}${suffix}`;
}

export function issuePdfHref(entry) {
  const base = issuePdfBase();
  const suffix = base.startsWith("/") ? `?download=1&v=${entry.version}` : "?download=1";
  return `${base}/${entry.pdfName}${suffix}`;
}

export function issuePageHref(prefix, entry) {
  return `${prefix}/magazines/${entry.n}/`;
}

export function issueReadHref(prefix, entry) {
  return `${prefix}/magazines/${entry.n}/read/`;
}

function coverImg(entry, locale, { sizes }) {
  if (!entry.cover) return `<span class="issue-cover" aria-hidden="true"></span>`;
  const t = issueText(locale);
  const width = Math.min(900, entry.cover.w);
  const height = Math.round((width * entry.cover.h) / entry.cover.w);
  const url = (variant) => `${entry.assetBase}/pages/001-${variant}.webp?v=${entry.version}`;
  return `<span class="issue-cover"><img loading="lazy" decoding="async" src="${escapeHtml(url("m"))}" ` +
    `srcset="${escapeHtml(url("s"))} 360w, ${escapeHtml(url("m"))} 900w" sizes="${sizes}" ` +
    `width="${width}" height="${height}" alt="${escapeHtml(t.coverAlt(entry.title))}"></span>`;
}

function metaLine(entry, locale) {
  const t = issueText(locale);
  const parts = [issueDateLabel(entry, locale), t.pages(formatIssueCount(entry.pages, locale))].filter(Boolean);
  return `<p class="card-meta">${escapeHtml(parts.join(" · "))}</p>`;
}

function buttons(entry, locale, prefix) {
  const t = issueText(locale);
  return `<div class="action-row review-actions">
        <a class="button-link primary" href="${escapeHtml(issueReadHref(prefix, entry))}" aria-label="${escapeHtml(t.readLabel(entry.title))}">${escapeHtml(t.read)}</a>
        <a class="button-link" href="${escapeHtml(issuePdfHref(entry))}" aria-label="${escapeHtml(t.pdfLabel(entry.title))}">${escapeHtml(t.pdf.replace("{size}", formatIssueSize(entry.pdfBytes, locale)))}</a>
      </div>`;
}

export function renderIssueCard(entry, locale, prefix) {
  const href = issuePageHref(prefix, entry);
  return `
    <li class="issue-card">
      <a class="issue-cover-link" href="${escapeHtml(href)}" tabindex="-1" aria-hidden="true">${coverImg(entry, locale, { sizes: "(max-width: 760px) 40vw, 150px" })}</a>
      <div class="issue-body">
        <h3 class="card-title"><a href="${escapeHtml(href)}">${escapeHtml(entry.title)}</a></h3>
        ${metaLine(entry, locale)}
        ${buttons(entry, locale, prefix)}
      </div>
    </li>`;
}

export function renderIssueHero(entry, locale, { prefix, markdownHref, alternatesHtml = "", previous = null, next = null }) {
  const t = issueText(locale);
  const nav = [];
  if (previous) nav.push(`<a href="${escapeHtml(issuePageHref(prefix, previous))}">${escapeHtml(t.previous)}: ${escapeHtml(previous.title)}</a>`);
  if (next) nav.push(`<a href="${escapeHtml(issuePageHref(prefix, next))}">${escapeHtml(t.next)}: ${escapeHtml(next.title)}</a>`);
  return `
    <section class="hero issue-hero">
      <div class="hero-grid">
        <div class="hero-cover">${coverImg(entry, locale, { sizes: "(max-width: 900px) 60vw, 320px" })}</div>
        <div class="hero-copy">
          <p class="kicker"><span class="kicker-rubric">proud magazine Berlin</span></p>
          <h1 class="label-title"><span class="label">${escapeHtml(entry.title)}</span></h1>
          <p class="deck">${escapeHtml(issueDateLabel(entry, locale))}${entry.date ? " · " : ""}${escapeHtml(t.pages(formatIssueCount(entry.pages, locale)))}</p>
          <div class="action-row" style="margin-top:0.8rem">
            <a class="button-link primary" href="${escapeHtml(issueReadHref(prefix, entry))}">${escapeHtml(t.read)}</a>
            <a class="button-link" href="${escapeHtml(issuePdfHref(entry))}">${escapeHtml(t.pdf.replace("{size}", formatIssueSize(entry.pdfBytes, locale)))}</a>
            <a class="button-link subtle" href="${escapeHtml(markdownHref)}">Markdown</a>
          </div>
          ${alternatesHtml ? `<div class="locale-nav compact-locale-nav">${alternatesHtml}</div>` : ""}
          ${nav.length ? `<p class="issue-nav">${nav.join(" · ")}</p>` : ""}
        </div>
      </div>
    </section>`;
}

export function renderIssueNotice(locale) {
  return `<p class="issue-notice">${escapeHtml(issueText(locale).notice)}</p>`;
}

export function renderRedirectPage({ target, locale, title }) {
  const t = issueText(locale);
  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="refresh" content="0; url=${escapeHtml(target)}">
    <link rel="canonical" href="${escapeHtml(target)}">
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(t.redirectTitle)}</p>
    <p>${escapeHtml(t.redirectLead)} <a href="${escapeHtml(target)}">${escapeHtml(target)}</a></p>
  </body>
</html>`;
}

export function issueJsonLd(entry, { base, locale, partOf }) {
  const t = issueText(locale);
  return {
    "@context": "https://schema.org",
    "@type": "PublicationIssue",
    name: entry.title,
    url: `${base}${locale === "en" ? "/en" : ""}/magazines/${entry.n}/`,
    inLanguage: locale === "en" ? "en" : "de",
    issueNumber: entry.n,
    ...(entry.date ? { datePublished: entry.date } : {}),
    numberOfPages: entry.pages,
    image: entry.cover ? `${base}${entry.assetBase}/pages/001-m.webp?v=${entry.version}` : undefined,
    associatedMedia: {
      "@type": "MediaObject",
      name: `${entry.title} PDF`,
      contentUrl: issuePdfPath(entry),
      encodingFormat: "application/pdf",
      contentSize: `${entry.pdfBytes} B`,
    },
    isPartOf: partOf,
    description: t.pages(formatIssueCount(entry.pages, locale)),
  };
}

// Routes, not urls: the site's breadcrumbJsonLd puts the base in front.
export function issueBreadcrumb(locale, entry) {
  const prefix = locale === "en" ? "/en" : "";
  return [
    { name: "proud", route: `${prefix}/` },
    { name: locale === "en" ? "Issues" : "Ausgaben", route: `${prefix}/magazines/` },
    { name: entry.title, route: `${prefix}/magazines/${entry.n}/` },
  ];
}

export function issueMarkdownLine(entry, locale, { base = "", prefix = "" } = {}) {
  const t = issueText(locale);
  const meta = [issueDateLabel(entry, locale), t.pages(entry.pages)].filter(Boolean).join(" · ");
  const page = `${base}${prefix}/magazines/${entry.n}/`;
  return `- [${entry.title}](${page}index.md): ${meta} · [${t.read}](${page}read/) · [PDF](${issuePdfPath(entry)})`;
}

export function readerMarkdownLines(entry, locale, { base = "", prefix = "" } = {}) {
  const t = issueText(locale);
  const lines = [`- [${t.back}](${base}${prefix}/magazines/${entry.n}/)`];
  for (let page = 1; page <= entry.pages; page += 1) {
    lines.push(`- [${t.page} ${page}](${base}${entry.assetBase}/pages/${String(page).padStart(3, "0")}-l.webp?v=${entry.version})`);
  }
  return lines;
}

// One row for /api/magazines.json and the head of each /api/magazines/<slug>.json.
export function issueApiSummary(entry, { base, prefix = "", magazine, displayTitle }) {
  return {
    slug: magazine.slug,
    title: magazine.title ?? entry.title,
    displayTitle,
    publicationDate: entry.date ?? magazine.publicationDate ?? null,
    sourcePdf: magazine.sourcePdf ?? null,
    pageCount: entry.pages,
    articleCount: magazine.articleCount ?? 0,
    url: `${base}${prefix}/magazines/${entry.n}/`,
    readerUrl: `${base}${prefix}/magazines/${entry.n}/read/`,
    pdfUrl: issuePdfPath(entry),
    pdfBytes: entry.pdfBytes,
  };
}

// The reader reserves the height of everything above it; measured header heights, one per viewport side.
export const READER_OFFSET_CSS = `.reader { --reader-offset: 11rem; }
@media (min-width: 900px) {
  .reader { --reader-offset: 7rem; }
}`;
