// node --test tests/ : /assets/issues/ allowlist, headers, range, conditional, local server twin.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";
import worker from "../cloudflare/worker.mjs";
import { parseIssueAsset } from "../src/lib/issues-route.mjs";

const IMAGE = Buffer.from("RIFF0000WEBPfake-image-bytes");
const PDF = Buffer.from("%PDF-1.4 fake pdf body for range tests");

// Behaves like real R2 (measured on workerd): whenever a range option is
// passed it sets `range`, whole object for a plain request, clamped, whole for
// out-of-range, whole for junk. A failed precondition returns no body.
function fakeBucket() {
  const objects = new Map([
    ["issues/24/pages/001-s.webp", { body: IMAGE, etag: '"img-1"' }],
    ["issues/24/proud-24.pdf", { body: PDF, etag: '"pdf-1"' }],
    ["legacy.pdf", { body: PDF, etag: '"legacy-1"' }],
  ]);

  return {
    async get(key, options = {}) {
      const entry = objects.get(key);
      if (!entry) return null;

      const size = entry.body.length;
      const object = {
        size,
        httpEtag: entry.etag,
        writeHttpMetadata(headers) {
          // Stored metadata is optional; the route sets the type itself.
          headers;
        },
        body: entry.body,
      };

      // Real R2 sets `range` whenever a range option is passed, even for a plain request.
      if (options.range) {
        const match = /^bytes=(\d*)-(\d*)$/.exec(options.range.get("range") ?? "");
        const usable = Boolean(match) && Boolean(match[1] || match[2]);
        let offset = 0;
        let end = size - 1;
        if (usable && !(match[1] && Number(match[1]) >= size)) {
          offset = match[1] ? Number(match[1]) : Math.max(0, size - Number(match[2]));
          end = match[1] && match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        }
        object.range = { offset, length: end - offset + 1 };
        object.body = entry.body.subarray(offset, end + 1);
      }

      const onlyIf = options.onlyIf;
      const ifMatch = onlyIf?.get("if-match");
      if (ifMatch && ifMatch !== entry.etag) {
        object.body = undefined;
      } else if (onlyIf?.get("if-none-match") === entry.etag) {
        object.body = undefined;
      }

      return object;
    },
  };
}

const env = {
  ASSETS: {
    async fetch() {
      return new Response(null, { status: 404 });
    },
  },
  PDFS_BUCKET: fakeBucket(),
};

const get = (target, headers = {}, method = "GET", base = "https://example.test") =>
  worker.fetch(new Request(`${base}${target}`, { method, headers }), env);

test("page image answers with webp, nosniff and a short cache", async () => {
  const res = await get("/assets/issues/24/pages/001-s.webp");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "image/webp");
  assert.equal(res.headers.get("x-content-type-options"), "nosniff");
  assert.equal(res.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(res.headers.get("accept-ranges"), "bytes");
  assert.equal(res.headers.get("content-length"), `${IMAGE.length}`);
  assert.equal(res.headers.get("content-range"), null);
  assert.equal((await res.arrayBuffer()).byteLength, IMAGE.length);
});

test("plain GET of a PDF is a 200 with content-length and no content-range", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-length"), `${PDF.length}`);
  assert.equal(res.headers.get("content-range"), null);
  assert.equal((await res.arrayBuffer()).byteLength, PDF.length);
});

test("?v= makes the response immutable", async () => {
  const res = await get("/assets/issues/24/pages/001-s.webp?v=ab12cd34");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
});

test("PDF is inline by default and an attachment with download=1", async () => {
  const inline = await get("/assets/issues/24/proud-24.pdf");
  assert.equal(inline.status, 200);
  assert.equal(inline.headers.get("content-type"), "application/pdf");
  assert.equal(inline.headers.get("content-disposition"), 'inline; filename="proud-24.pdf"');

  const download = await get("/assets/issues/24/proud-24.pdf?download=1");
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-disposition"), 'attachment; filename="proud-24.pdf"');
});

test("range request answers 206 with content-range", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { Range: "bytes=0-7" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 0-7/${PDF.length}`);
  assert.equal(res.headers.get("content-length"), "8");
  assert.equal((await res.arrayBuffer()).byteLength, 8);
});

test("suffix range answers 206 with the last bytes", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { Range: "bytes=-4" });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes ${PDF.length - 4}-${PDF.length - 1}/${PDF.length}`);
  assert.equal(res.headers.get("content-length"), "4");
  assert.equal((await res.arrayBuffer()).byteLength, 4);
});

test("an unsatisfiable range answers the whole file with 200", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { Range: "bytes=5000-6000" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-range"), null);
  assert.equal(res.headers.get("content-length"), `${PDF.length}`);
  assert.equal((await res.arrayBuffer()).byteLength, PDF.length);
});

test("a junk range answers the whole file with 200", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { Range: "bytes=abc" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-range"), null);
  assert.equal((await res.arrayBuffer()).byteLength, PDF.length);
});

test("matching If-None-Match answers 304", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { "If-None-Match": '"pdf-1"' });
  assert.equal(res.status, 304);
  assert.equal(res.headers.get("etag"), '"pdf-1"');
  assert.equal(res.headers.get("content-range"), null);
  assert.equal(await res.text(), "");
});

test("a failed If-Match answers 412", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { "If-Match": '"nope"' });
  assert.equal(res.status, 412);
  assert.equal(res.headers.get("etag"), '"pdf-1"');
  assert.equal(await res.text(), "");
});

test("HEAD answers headers only", async () => {
  const res = await get("/assets/issues/24/pages/001-s.webp", {}, "HEAD");
  assert.equal(res.status, 200);
  assert.equal(await res.text(), "");
  assert.equal(res.headers.get("content-type"), "image/webp");
});

test("HEAD with a range answers the same 206 as GET", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", { Range: "bytes=0-7" }, "HEAD");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-range"), `bytes 0-7/${PDF.length}`);
  assert.equal(await res.text(), "");
});

test("bad paths answer 404", async () => {
  const bad = [
    "/assets/issues/24/pages/001-s.jpg",
    "/assets/issues/2/pages/001-s.webp",
    "/assets/issues/24/pages/01-s.webp",
    "/assets/issues/24/pages/001-x.webp",
    "/assets/issues/24/proud-25.pdf",
    "/assets/issues/24/review/contact.jpg",
    "/assets/issues/24/_state/uploaded.json",
    "/assets/issues/24/PAGES/001-S.WEBP",
    "/assets/issues/24//pages/001-s.webp",
    "/assets/issues/24%2Fpages%2F001-s.webp",
    "/assets/issues/24/",
    "/assets/issues/",
  ];
  for (const target of bad) {
    const res = await get(target);
    assert.equal(res.status, 404, target);
    assert.equal(await res.text(), "Not found", target);
  }
});

test("missing bucket answers 404", async () => {
  const res = await worker.fetch(new Request("https://example.test/assets/issues/24/proud-24.pdf"), { ASSETS: env.ASSETS });
  assert.equal(res.status, 404);
  assert.equal(await res.text(), "Not found");
});

test("unsupported methods answer 405 with Allow", async () => {
  const res = await get("/assets/issues/24/proud-24.pdf", {}, "POST");
  assert.equal(res.status, 405);
  assert.equal(res.headers.get("allow"), "GET, HEAD");
});

test("the old /assets/pdfs/ route still answers the same", async () => {
  const res = await get("/assets/pdfs/legacy.pdf");
  // Known flaw, left alone here: it still answers 206 for a plain request.
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("content-type"), "application/pdf");
  const noBucket = await worker.fetch(new Request("https://example.test/assets/pdfs/legacy.pdf"), { ASSETS: env.ASSETS });
  assert.equal(noBucket.status, 404);
  assert.equal(await noBucket.text(), "PDF bucket not configured");
});

const localDir = path.join(os.tmpdir(), `proud-issues-route-${process.pid}`);
const port = 8791;
let server;

before(async () => {
  await fsp.mkdir(path.join(localDir, "24", "pages"), { recursive: true });
  await fsp.writeFile(path.join(localDir, "24", "pages", "001-s.webp"), IMAGE);
  await fsp.writeFile(path.join(localDir, "24", "proud-24.pdf"), PDF);
  await fsp.writeFile(path.join(localDir, "24", "review-contact.jpg"), IMAGE);

  server = spawn(process.execPath, [path.join(import.meta.dirname, "..", "src", "serve.mjs")], {
    env: { ...process.env, PORT: `${port}`, PROUD_ISSUES_DIR: localDir },
    stdio: ["ignore", "pipe", "inherit"],
  });
  await new Promise((resolve, reject) => {
    let out = "";
    server.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("listening")) resolve();
    });
    server.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
});

after(async () => {
  server?.kill();
  await fsp.rm(localDir, { recursive: true, force: true });
});

test("local server does not pile up Link headers from request to request", async () => {
  const count = async () => {
    const res = await fetch(`http://127.0.0.1:${port}/magazines/`);
    await res.arrayBuffer();
    return (res.headers.get("link") ?? "").split(", <").length;
  };
  const first = await count();
  for (let i = 0; i < 5; i += 1) await count();
  assert.equal(await count(), first);
});

test("local server answers the same allowlist and headers", async () => {
  assert.equal(parseIssueAsset("/assets/issues/24/pages/001-m.webp").relative, "24/pages/001-m.webp");

  const image = await fetch(`http://127.0.0.1:${port}/assets/issues/24/pages/001-s.webp?v=ab12cd34`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/webp");
  assert.equal(image.headers.get("x-content-type-options"), "nosniff");
  assert.equal(image.headers.get("cache-control"), "public, max-age=31536000, immutable");

  const pdf = await fetch(`http://127.0.0.1:${port}/assets/issues/24/proud-24.pdf?download=1`, { headers: { Range: "bytes=0-7" } });
  assert.equal(pdf.status, 206);
  assert.equal(pdf.headers.get("content-disposition"), 'attachment; filename="proud-24.pdf"');
  assert.equal(pdf.headers.get("content-range"), `bytes 0-7/${PDF.length}`);
  assert.equal((await pdf.arrayBuffer()).byteLength, 8);

  const junk = await fetch(`http://127.0.0.1:${port}/assets/issues/24/proud-24.pdf`, { headers: { Range: "bytes=abc" } });
  assert.equal(junk.status, 200);
  assert.equal((await junk.arrayBuffer()).byteLength, PDF.length);

  const unmatched = await fetch(`http://127.0.0.1:${port}/assets/issues/24/proud-24.pdf`, { headers: { "If-Match": '"nope"' } });
  assert.equal(unmatched.status, 412);

  for (const target of ["/assets/issues/24/pages/001-s.jpg", "/assets/issues/24/review/contact.jpg", "/assets/issues/24/proud-25.pdf", "/assets/issues/24%2Fpages%2F001-s.webp"]) {
    const res = await fetch(`http://127.0.0.1:${port}${target}`);
    assert.equal(res.status, 404, target);
  }
});
