// node --test tests/ : editorial data + honesty rules for the built site.
// The site tests read the committed site/ output, so run `npm run build:site` before them after template changes.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildPeople, bylineFor, legalIsComplete, loadEditorialData, slugifyName } from "../scripts/lib/editorial.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const site = path.join(root, "site");
const editorial = await loadEditorialData(root);
const articles = fs.readdirSync(path.join(root, "data/output/articles")).map((file) => JSON.parse(fs.readFileSync(path.join(root, "data/output/articles", file), "utf8")));
const people = buildPeople(editorial, articles);
const bySlug = new Map(people.map((person) => [person.slug, person]));

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(html|md|txt|json|xml)$/.test(entry.name) && !full.includes(`${path.sep}api${path.sep}library.json`) && !full.includes("search-index.json")) out.push(full);
  }
  return out;
}

test("people come only from printed credits and masthead roles", () => {
  assert.ok(bySlug.has("moritz-stellmacher"));
  assert.ok(bySlug.get("moritz-stellmacher").bio, "printed bio kept");
  assert.equal(bySlug.get("lukas-kampfmann").bio, null, "no invented bio");
  for (const notPerson of ["flickr-com", "janadler-com", "www-marenboettcher-com", "rouge-bunny-rouge"]) {
    assert.ok(!bySlug.has(notPerson), `${notPerson} is a source, not a person`);
  }
  // Low-confidence poster credits (zey-break) do not create author pages.
  assert.ok(!bySlug.has(slugifyName("Zula Lemes")));
  assert.deepEqual(bySlug.get("peta-pumpa").printedAs, ["Pumpa Peta"]);
});

test("love-in-berlin byline is exactly the printed credit box", () => {
  const article = articles.find((entry) => entry.slug === "love-in-berlin");
  const byline = bylineFor(editorial, article, bySlug, "de");
  assert.deepEqual(byline.authors.map((entry) => entry.name), ["Lukas Kampfmann"]);
  assert.deepEqual(byline.secondary.map((entry) => `${entry.label}: ${entry.name}`), ["Layout: Christian Rothenhagen"]);
});

test("articles without printed credit get no byline", () => {
  const article = articles.find((entry) => entry.slug === "pentagonik");
  const byline = bylineFor(editorial, article, bySlug, "de");
  assert.equal(byline.authors.length + byline.secondary.length, 0);
  const html = fs.readFileSync(path.join(site, "articles/pentagonik/index.html"), "utf8");
  assert.doesNotMatch(html, /class="byline"/);
});

test("legal pages stay off until config/legal.json is complete", () => {
  assert.equal(legalIsComplete({}), false);
  assert.equal(legalIsComplete({ operatorName: "x", responsibleEditor: "x", street: "x", postalCode: "x", city: "x", email: "x" }), true);
  if (!legalIsComplete(editorial.legal)) {
    assert.ok(!fs.existsSync(path.join(site, "impressum")), "no impressum without data");
    assert.doesNotMatch(fs.readFileSync(path.join(site, "index.html"), "utf8"), /href="\/impressum\//);
  }
});

test("built site contains no unverified claims", () => {
  const banned = [/(DFJV|Fachjournalisten)[^.]{0,80}(anerkannt|ausgezeichnet|recogni[sz]ed|award|honou?red|mehrfach)/i, /(anerkannt|ausgezeichnet|recogni[sz]ed|awarded)[^.]{0,40}(DFJV|Fachjournalisten)/i, /dfjv\.de/i, /1[.,]5\s*(million|Millionen|Mio)/i, /\bISSN\b/, /650[.,]000/];
  const offenders = [];
  for (const file of walk(site)) {
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of banned) if (pattern.test(text)) offenders.push(`${path.relative(site, file)} ${pattern}`);
  }
  assert.deepEqual(offenders, []);
});

test("current publisher vs. 2009 masthead stay distinct", () => {
  const about = fs.readFileSync(path.join(site, "about/index.html"), "utf8");
  assert.match(about, /Herausgeber heute: Emin Mahrt/);
  assert.match(about, /Heft 01 \(2009\): Herausgeber laut Impressum Richard Kirschstein und Emin Henri Mahrt/);
  const masthead = fs.readFileSync(path.join(site, "masthead/index.html"), "utf8");
  assert.match(masthead, /So gedruckt im Impressum von Heft 01/);
  assert.match(masthead, /Richard Kirschstein/);
  for (const file of ["about/index.html", "en/about/index.html", "press/index.html", "en/press/index.html", "index.html"]) {
    const html = fs.readFileSync(path.join(site, file), "utf8");
    assert.doesNotMatch(html, /(sole|alleiniger?) (publisher|Herausgeber)/i, file);
  }
});

test("DFJV appears only as the dated 2009 newsletter quote on About and Press", () => {
  const de = "Der Deutsche Fachjournalisten-Verband stellte proud im Newsletter DFJV-News vom 7. Mai 2009 vor: „bunt, aufregend, frisch und eben anders.“";
  for (const file of ["about/index.html", "press/index.html", "about/index.md", "press/index.md"]) {
    assert.ok(fs.readFileSync(path.join(site, file), "utf8").replace(/<[^>]+>/g, "").includes(de), file);
  }
  for (const file of ["en/about/index.html", "en/press/index.html"]) {
    const html = fs.readFileSync(path.join(site, file), "utf8");
    assert.match(html.replace(/<span class="proud-word">(proud)<\/span>/g, "$1"), /featured proud in its newsletter DFJV-News of 7 May 2009/);
    assert.match(html, /<cite>DFJV-News, May 2009<\/cite>/);
  }
  const pages = walk(site).filter((file) => /DFJV/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(site, file)).sort();
  assert.ok(pages.every((file) => /^(en\/)?(about|press)\/index\.(html|md)$/.test(file) || /llms(-full)?\.txt$/.test(file)), pages.join(","));
});

test("print run appears only with the self-reported qualifier", () => {
  for (const [file, qualifier] of [["press/index.html", "Nach Angaben der Herausgeber"], ["en/press/index.html", "According to the publishers"]]) {
    const html = fs.readFileSync(path.join(site, file), "utf8");
    if (/20[.,]000/.test(html)) assert.match(html, new RegExp(qualifier));
  }
});

test("new pages exist in de + en with Markdown twins and sitemap entries", () => {
  const sitemap = fs.readFileSync(path.join(site, "sitemap.xml"), "utf8");
  const llms = fs.readFileSync(path.join(site, "llms.txt"), "utf8");
  for (const key of ["about", "masthead", "standards", "press", "corrections", "archive-guide", "authors", "authors/moritz-stellmacher"]) {
    for (const prefix of ["", "en/"]) {
      assert.ok(fs.existsSync(path.join(site, prefix, key, "index.html")), `${prefix}${key} html`);
      assert.ok(fs.existsSync(path.join(site, prefix, key, "index.md")), `${prefix}${key} md`);
      assert.match(sitemap, new RegExp(`/${prefix}${key}/</loc>`));
    }
    assert.match(llms, new RegExp(`/${key}/index.md`));
  }
});

test("home JSON-LD: verified sameAs, ZDB id, no foundingDate, current publisher is the person Emin Mahrt", () => {
  const html = fs.readFileSync(path.join(site, "index.html"), "utf8");
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])["@graph"];
  const org = graph.find((node) => node["@type"] === "NewsMediaOrganization");
  assert.deepEqual(org.sameAs, ["https://d-nb.info/992028108", "https://issuu.com/proud"]);
  assert.equal(org.identifier.value, "2473146-8");
  assert.equal(org.foundingDate, undefined);
  assert.equal(org.founder["@type"], "Person");
  assert.equal(org.founder.name, "Emin Henri Mahrt");
  const website = graph.find((node) => node["@type"] === "WebSite");
  assert.equal(website.publisher["@type"], "Person");
  assert.doesNotMatch(JSON.stringify(graph), /works GmbH/i);
  assert.match(org.correctionsPolicy, /\/corrections\/$/);
  assert.match(org.masthead, /\/masthead\/$/);
});

test("article JSON-LD carries printed author, contributor and breadcrumb", () => {
  const html = fs.readFileSync(path.join(site, "articles/love-in-berlin/index.html"), "utf8");
  const graph = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])["@graph"];
  const article = graph.find((node) => node["@type"] === "Article");
  assert.deepEqual(article.author.map((person) => person.name), ["Lukas Kampfmann"]);
  assert.deepEqual(article.contributor.map((person) => person.name), ["Christian Rothenhagen"]);
  assert.equal(article.isPartOf.issueNumber, "01");
  assert.equal(article.isPartOf.datePublished, "2009-01");
  assert.ok(graph.some((node) => node["@type"] === "BreadcrumbList"));
});

test("design v2: real ambigram logo, label headings, rubric pages", () => {
  const svg = fs.readFileSync(path.join(root, "src/brand/proud-logo.svg"), "utf8");
  assert.match(svg, /<title[^>]*>proud<\/title>/);
  assert.match(svg, /role="img"/);
  assert.match(svg, /fill="#ed0677"/);
  for (const file of ["index.html", "en/index.html", "articles/love-in-berlin/index.html"]) {
    const html = fs.readFileSync(path.join(site, file), "utf8");
    assert.match(html, /<a class="logo-link" href="[^"]*" aria-label="proud magazine Berlin (home|Startseite)"><svg class="logo" aria-hidden="true"/, file);
    assert.match(html, /<h1 class="label-title"><span class="label">/, file);
  }
  const css = fs.readFileSync(path.join(site, "assets/site.css"), "utf8");
  assert.match(css, /\.logo-link:hover \.logo, \.logo-link:focus \.logo, \.logo-link:active \.logo \{ transform: rotate\(180deg\)/);
  assert.match(css, /prefers-reduced-motion: reduce\)[\s\S]*?transform: none/);
  const sitemap = fs.readFileSync(path.join(site, "sitemap.xml"), "utf8");
  for (const prefix of ["", "en/"]) {
    assert.ok(fs.existsSync(path.join(site, prefix, "rubrics/streets-ahead/index.html")));
    assert.ok(fs.existsSync(path.join(site, prefix, "rubrics/streets-ahead/index.md")));
    assert.match(sitemap, new RegExp(`/${prefix}rubrics/chat/</loc>`));
  }
  const graph = JSON.parse(fs.readFileSync(path.join(site, "index.html"), "utf8").match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1])["@graph"];
  assert.match(graph.find((node) => node["@type"] === "NewsMediaOrganization").logo.url, /\/assets\/logo-1200\.png$/);
  assert.ok(fs.existsSync(path.join(site, "assets/logo-1200.png")));
});
