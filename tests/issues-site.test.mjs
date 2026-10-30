import assert from "node:assert/strict";
import test from "node:test";
import {
  buildIssueEntries,
  formatIssueSize,
  issueDateLabel,
  issueNumberOf,
  issuePdfHref,
  issueReadHref,
  renderIssueCard,
  renderIssueHero,
  renderIssueNotice,
  renderRedirectPage,
  issueApiSummary,
  issueJsonLd,
  issueMarkdownLine,
  readerMarkdownLines,
} from "../scripts/lib/issues-site.mjs";

const manifest = (n, extra = {}) => ({
  issue: n,
  title: `proud #${n}`,
  pages: 68,
  layout: "single",
  pagesInfo: [
    { n: 1, srcPage: 1, half: null, w: 1800, h: 2413 },
    { n: 2, srcPage: 2, half: null, w: 1800, h: 2413 },
  ],
  web: { pdf: `proud-${n}.pdf`, bytes: 26214400, sha256: "abcdef1234" },
  ...extra,
});

test("issue number comes out of every known seed", () => {
  assert.equal(issueNumberOf("24"), "24");
  assert.equal(issueNumberOf("01-proud-issuu-output"), "01");
  assert.equal(issueNumberOf("07 proud issuu_output.pdf"), "07");
  assert.equal(issueNumberOf("abend_01"), null);
});

test("entries sort newest first and only when known carry a date", () => {
  const entries = buildIssueEntries([manifest("09"), manifest("24"), manifest("32")], { 24: "2011", "09": "2009-10" });
  assert.deepEqual(entries.map((entry) => entry.n), ["32", "24", "09"]);
  assert.equal(entries[0].date, null);
  assert.equal(entries[1].date, "2011");
  assert.equal(issueDateLabel(entries[1], "de"), "2011");
  assert.equal(issueDateLabel(buildIssueEntries([manifest("18")], { 18: "2010-07" })[0], "en"), "July 2010");
});

test("entries carry the cover size and the pdf version", () => {
  const [entry] = buildIssueEntries([manifest("24")]);
  assert.deepEqual(entry.cover, { w: 1800, h: 2413 });
  assert.equal(entry.version, "abcdef12");
  assert.equal(issuePdfHref(entry), "/assets/issues/24/proud-24.pdf?download=1&v=abcdef12");
  assert.equal(issueReadHref("/en", entry), "/en/magazines/24/read/");
  assert.equal(formatIssueSize(26214400, "de"), "25,0");
});

test("card carries cover srcset, title, date, pages, read and pdf", () => {
  const [entry] = buildIssueEntries([manifest("24")], { 24: "2011" });
  const html = renderIssueCard(entry, "de", "");
  assert.match(html, /src="\/assets\/issues\/24\/pages\/001-m\.webp\?v=abcdef12"/);
  assert.match(html, /srcset="\/assets\/issues\/24\/pages\/001-s\.webp\?v=abcdef12 360w/);
  assert.match(html, /alt="proud #24, Titelseite"/);
  assert.match(html, /width="900" height="1207"/);
  assert.match(html, /<a href="\/magazines\/24\/">/);
  assert.match(html, /2011 · 68 Seiten/);
  assert.match(html, /href="\/magazines\/24\/read\/"/);
  assert.match(html, /PDF, 25,0 MB/);
});

test("english card and hero use english words", () => {
  const [entry] = buildIssueEntries([manifest("24")]);
  assert.match(renderIssueCard(entry, "en", "/en"), /alt="proud #24, cover"/);
  const hero = renderIssueHero(entry, "en", { prefix: "/en", markdownHref: "/en/magazines/24/index.md", next: buildIssueEntries([manifest("02")])[0] });
  assert.match(hero, /<h1 class="label-title">/);
  assert.match(hero, /Next issue/);
  assert.match(hero, /href="\/en\/magazines\/02\/"/);
  assert.match(hero, /PDF, 25\.0 MB/);
});

test("notice and redirect page are plain and honest", () => {
  assert.match(renderIssueNotice("de"), /werden noch erfasst/);
  assert.match(renderIssueNotice("en"), /still being transcribed/);
  const page = renderRedirectPage({ target: "/magazines/01/", locale: "de", title: "proud #01" });
  assert.match(page, /http-equiv="refresh" content="0; url=\/magazines\/01\/"/);
  assert.match(page, /<link rel="canonical" href="\/magazines\/01\/">/);
  assert.match(page, /<a href="\/magazines\/01\/">/);
});

test("json-ld has issue, media and part of the periodical", () => {
  const [entry] = buildIssueEntries([manifest("23")], { 23: "2011" });
  const data = issueJsonLd(entry, { base: "https://x.tld", locale: "de", partOf: { "@id": "https://x.tld/#periodical" } });
  assert.equal(data["@type"], "PublicationIssue");
  assert.equal(data.issueNumber, "23");
  assert.equal(data.datePublished, "2011");
  assert.equal(data.numberOfPages, 68);
  assert.equal(data.image, "https://x.tld/assets/issues/23/pages/001-m.webp?v=abcdef12");
  assert.equal(data.associatedMedia.encodingFormat, "application/pdf");
  assert.equal(data.associatedMedia.contentSize, "26214400 B");
  assert.deepEqual(data.isPartOf, { "@id": "https://x.tld/#periodical" });
});

test("markdown line and api summary carry read, pdf and the right prefix", () => {
  const [entry] = buildIssueEntries([manifest("24")], { 24: "2011" });
  const line = issueMarkdownLine(entry, "en", { base: "https://x.tld", prefix: "/en" });
  assert.equal(
    line,
    "- [proud #24](https://x.tld/en/magazines/24/index.md): 2011 · 68 pages · [Read](https://x.tld/en/magazines/24/read/) · [PDF](https://x.tld/assets/issues/24/proud-24.pdf?v=abcdef12)",
  );
  const api = issueApiSummary(entry, { base: "https://x.tld", magazine: { slug: "24", articleCount: 0 }, displayTitle: "proud #24" });
  assert.equal(api.pageCount, 68);
  assert.equal(api.publicationDate, "2011");
  assert.equal(api.readerUrl, "https://x.tld/magazines/24/read/");
  assert.equal(api.pdfUrl, "https://x.tld/assets/issues/24/proud-24.pdf?v=abcdef12");
  assert.equal(api.pdfBytes, 26214400);
});

test("reader markdown lists every page once, in order", () => {
  const [entry] = buildIssueEntries([manifest("24", { pages: 3 })]);
  const lines = readerMarkdownLines(entry, "de", { base: "https://x.tld" });
  assert.equal(lines.length, 4);
  assert.match(lines[1], /Seite 1\]\(https:\/\/x\.tld\/assets\/issues\/24\/pages\/001-l\.webp\?v=abcdef12\)/);
  assert.match(lines[3], /Seite 3/);
});

test("hero names the neighbouring issues", () => {
  const [one, two, three] = buildIssueEntries([manifest("01"), manifest("02"), manifest("03")]).reverse();
  const hero = renderIssueHero(two, "de", { prefix: "", markdownHref: "/magazines/02/index.md", previous: one, next: three });
  assert.match(hero, /Vorherige Ausgabe: proud #01/);
  assert.match(hero, /Nächste Ausgabe: proud #03/);
});
