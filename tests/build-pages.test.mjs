import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const SCRIPT = path.join(import.meta.dirname, "..", "scripts", "build-pages.mjs");

test("pages mirror loads issue pages and PDFs from the Worker host, everything else from the mirror", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pages-test-"));
  const src = path.join(dir, "site");
  const out = path.join(dir, "out");
  await fs.mkdir(path.join(src, "magazines"), { recursive: true });
  await fs.writeFile(
    path.join(src, "magazines", "index.html"),
    [
      '<a href="/magazines/24/read/">Lesen</a>',
      '<img src="/assets/issues/24/pages/001-m.webp?v=ab" srcset="/assets/issues/24/pages/001-s.webp?v=ab 360w, /assets/issues/24/pages/001-m.webp?v=ab 900w">',
      '<a href="/assets/issues/24/proud-24.pdf?download=1&amp;v=ab">PDF</a>',
      '<link rel="canonical" href="https://worker.test/magazines/">',
    ].join("\n"),
  );
  await fs.writeFile(path.join(src, "llms.txt"), "- [PDF](https://proud.xn--wp9h.tk/assets/issues/24/proud-24.pdf?v=ab)\n- [Lesen](/magazines/24/read/)\n");

  await run(process.execPath, [SCRIPT, src, out], { env: { ...process.env, PAGES_ORIGIN: "https://pages.test", PAGES_BASE_PATH: "/proud-de", SOURCE_ORIGIN: "https://worker.test" } });

  const html = await fs.readFile(path.join(out, "magazines", "index.html"), "utf8");
  assert.match(html, /href="\/proud-de\/magazines\/24\/read\/"/);
  assert.match(html, /src="https:\/\/worker\.test\/assets\/issues\/24\/pages\/001-m\.webp\?v=ab"/);
  assert.match(html, /srcset="https:\/\/worker\.test\/assets\/issues\/24\/pages\/001-s\.webp\?v=ab 360w, https:\/\/worker\.test\/assets\/issues\/24\/pages\/001-m\.webp\?v=ab 900w"/);
  assert.match(html, /href="https:\/\/worker\.test\/assets\/issues\/24\/proud-24\.pdf\?download=1&amp;v=ab"/);
  assert.match(html, /href="https:\/\/pages\.test\/proud-de\/magazines\/"/);
  assert.doesNotMatch(html, /\/proud-de\/assets\/issues\//);

  const llms = await fs.readFile(path.join(out, "llms.txt"), "utf8");
  assert.match(llms, /\(https:\/\/worker\.test\/assets\/issues\/24\/proud-24\.pdf\?v=ab\)/);
  assert.match(llms, /\(\/proud-de\/magazines\/24\/read\/\)/);
  await fs.rm(dir, { recursive: true, force: true });
});
