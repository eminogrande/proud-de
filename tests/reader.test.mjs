// node --test tests/ : reader view maths, dictionary, rendered HTML.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { viewFor, nextView, prevView, parsePageParam, keyAction } from "../src/reader/reader.js";
import { READER_TEXT, renderReaderMain } from "../scripts/lib/reader.mjs";

const manifest = JSON.parse(readFileSync(new URL("./fixtures/reader-manifest.json", import.meta.url), "utf8"));

const render = (overrides = {}) =>
  renderReaderMain({
    locale: "de",
    manifest,
    assetBase: "/assets/issues/01",
    version: "deadbeef",
    title: "proud #01",
    dateLabel: "Januar 2009",
    hrefs: { overview: "/magazines/", issue: "/magazines/01/" },
    startPage: 1,
    ...overrides,
  });

function walk(pageCount, pair) {
  const seen = [];
  let view = viewFor(1, pageCount, pair);
  for (let guard = 0; guard < 500; guard += 1) {
    seen.push(...view);
    const next = nextView(view, pageCount, pair);
    if (next.join() === view.join()) {
      return seen;
    }
    view = next;
  }
  throw new Error("next walk did not terminate");
}

test("viewFor keeps the cover alone and pairs facing pages", () => {
  assert.deepEqual(viewFor(1, 68, true), [1]);
  assert.deepEqual(viewFor(2, 68, true), [2, 3]);
  assert.deepEqual(viewFor(3, 68, true), [2, 3]);
  assert.deepEqual(viewFor(67, 68, true), [66, 67]);
  assert.deepEqual(viewFor(68, 68, true), [68]);
  assert.deepEqual(viewFor(68, 67, true), [66, 67]);
  assert.deepEqual(viewFor(1, 1, true), [1]);
  assert.deepEqual(viewFor(1, 68, false), [1]);
  assert.deepEqual(viewFor(68, 68, false), [68]);
  assert.deepEqual(viewFor(1, 1, false), [1]);
});

test("next and prev reach every page once, in both modes", () => {
  for (const pair of [true, false]) {
    for (const count of [68, 67, 1]) {
      const seen = walk(count, pair);
      assert.equal(seen.length, count);
      assert.deepEqual([...seen].sort((a, b) => a - b), Array.from({ length: count }, (_v, i) => i + 1));
    }
  }
});

test("prev walks back to the cover", () => {
  let view = viewFor(68, 68, true);
  const seen = [...view];
  for (let guard = 0; guard < 500; guard += 1) {
    const prev = prevView(view, 68, true);
    if (prev.join() === view.join()) {
      break;
    }
    view = prev;
    seen.unshift(...view);
  }
  assert.deepEqual(view, [1]);
  assert.equal(seen.length, 68);
});

test("next and prev stay put at the ends", () => {
  assert.deepEqual(nextView([68], 68, true), [68]);
  assert.deepEqual(prevView([1], 68, true), [1]);
  assert.deepEqual(nextView([1], 1, true), [1]);
});

test("parsePageParam takes junk, clamps, ignores negatives", () => {
  assert.equal(parsePageParam("12", 68), 12);
  assert.equal(parsePageParam(null, 68), 1);
  assert.equal(parsePageParam(undefined, 68), 1);
  assert.equal(parsePageParam("", 68), 1);
  assert.equal(parsePageParam("abc", 68), 1);
  assert.equal(parsePageParam("-4", 68), 1);
  assert.equal(parsePageParam("0", 68), 1);
  assert.equal(parsePageParam("999", 68), 68);
  assert.equal(parsePageParam("3.9", 68), 3);
});

test("de and en dictionaries share every key", () => {
  assert.deepEqual(Object.keys(READER_TEXT.de).sort(), Object.keys(READER_TEXT.en).sort());
  assert.ok(Object.keys(READER_TEXT.de).length >= 13);
});

test("no em dash in any reader word", () => {
  for (const [locale, words] of Object.entries(READER_TEXT)) {
    for (const [key, value] of Object.entries(words)) {
      assert.ok(!value.includes("\u2014"), `${locale}.${key} has an em dash`);
    }
  }
});

test("rendered HTML has one h1, one item per page, sized and alt texted images", () => {
  const html = render();
  assert.equal((html.match(/<h1/g) ?? []).length, 1);
  const items = html.match(/<li><a href=/g) ?? [];
  assert.equal(items.length, 10);
  const images = html.match(/<img /g) ?? [];
  assert.equal(images.length, 20);
  for (const page of manifest.pagesInfo) {
    assert.match(html, new RegExp(`alt="proud #01, Seite ${page.n}"`));
    assert.match(html, new RegExp(`width="${page.w}" height="${page.h}"`));
  }
});

test("every binary URL carries the version", () => {
  const urls = [...render().matchAll(/(?:src|href|srcset)="([^"]+)"/g)].flatMap((match) => match[1].split(", "));
  const binaries = urls.filter((url) => /\.webp|\.pdf/.test(url));
  assert.ok(binaries.length >= 30);
  for (const url of binaries) {
    assert.match(url, /(?:[?&]|&amp;)v=deadbeef/, url);
  }
  assert.match(render(), /href="\/assets\/issues\/01\/proud-01\.pdf\?download=1&amp;v=deadbeef"/);
});

test("interpolated values are escaped", () => {
  const html = render({ title: 'a "b" <i>', dateLabel: "x & y" });
  assert.match(html, /&quot;b&quot; &lt;i&gt;/);
  assert.match(html, /x &amp; y/);
  assert.ok(!html.includes('alt="a "b"'));
});

test("unknown locale falls back to English and start page is clamped", () => {
  const html = render({ locale: "fr", startPage: 99 });
  assert.match(html, /data-start-page="10"/);
  assert.match(html, /PDF, 28 MB/);
  assert.match(html, /Back to issue/);
});

const press = (key, extra = {}) => ({ key, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, target: { tagName: "BODY" }, ...extra });

test("keyAction maps page keys on the page body", () => {
  assert.equal(keyAction(press("ArrowRight")), "next");
  assert.equal(keyAction(press("PageDown")), "next");
  assert.equal(keyAction(press(" ")), "next");
  assert.equal(keyAction(press("ArrowLeft")), "prev");
  assert.equal(keyAction(press("PageUp")), "prev");
  assert.equal(keyAction(press(" ", { shiftKey: true })), "prev");
  assert.equal(keyAction(press("Home")), "first");
  assert.equal(keyAction(press("End")), "last");
  assert.equal(keyAction(press("a")), null);
  assert.equal(keyAction({}), null);
});

test("keyAction leaves modifier chords to the browser", () => {
  for (const modifier of ["metaKey", "ctrlKey", "altKey"]) {
    assert.equal(keyAction(press("ArrowLeft", { [modifier]: true })), null, modifier);
    assert.equal(keyAction(press("ArrowRight", { [modifier]: true })), null, modifier);
    assert.equal(keyAction(press(" ", { [modifier]: true })), null, modifier);
  }
  assert.equal(keyAction(press("ArrowRight", { shiftKey: true })), "next");
});

test("keyAction keeps Space for buttons, links and summary, arrows still turn", () => {
  for (const tagName of ["BUTTON", "A", "SUMMARY"]) {
    assert.equal(keyAction(press(" ", { target: { tagName } })), null, tagName);
    assert.equal(keyAction(press("ArrowRight", { target: { tagName } })), "next", tagName);
  }
  assert.equal(keyAction(press(" ", { target: { tagName: "INPUT" } })), null);
  assert.equal(keyAction(press("ArrowRight", { target: { tagName: "TEXTAREA" } })), null);
});

test("srcset descriptors are the real widths of the l and m files", () => {
  const html = render();
  assert.match(html, /\/pages\/002-m\.webp\?v=deadbeef 900w, \/assets\/issues\/01\/pages\/002-l\.webp\?v=deadbeef 1492w/);
  assert.match(html, /\/pages\/004-m\.webp\?v=deadbeef 808w, \/assets\/issues\/01\/pages\/004-l\.webp\?v=deadbeef 808w/);
  assert.match(html, /\/pages\/001-l\.webp\?v=deadbeef 1800w/);
});
