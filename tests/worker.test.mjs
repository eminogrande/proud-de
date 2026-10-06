// node --test tests/ : worker routing contract (404 bodies, Vary, cache, removed OAuth).
import assert from "node:assert/strict";
import test from "node:test";
import worker from "../cloudflare/worker.mjs";

const files = new Map([
  ["/", { body: "<!doctype html><title>home</title>", type: "text/html; charset=utf-8" }],
  ["/index.md", { body: "# home", type: "text/markdown; charset=utf-8" }],
  ["/assets/hero/x.webp", { body: "RIFF", type: "image/webp" }],
]);

const env = {
  ASSETS: {
    async fetch(request) {
      const { pathname } = new URL(request.url);
      const file = files.get(pathname);
      return file
        ? new Response(file.body, { status: 200, headers: { "Content-Type": file.type, "Cache-Control": "public, max-age=0, must-revalidate" } })
        : new Response(null, { status: 404 });
    },
  },
};

const get = (path, headers = {}, method = "GET") => worker.fetch(new Request(`https://example.test${path}`, { method, headers }), env);

test("HTML and negotiated Markdown both vary on Accept", async () => {
  const html = await get("/");
  assert.equal(html.status, 200);
  assert.match(html.headers.get("vary"), /accept/i);
  assert.match(html.headers.get("cache-control"), /max-age=300/);
  const md = await get("/", { Accept: "text/markdown" });
  assert.match(md.headers.get("content-type"), /text\/markdown/);
  assert.match(md.headers.get("vary"), /accept/i);
});

test("page 404 returns a Markdown recovery body", async () => {
  const res = await get("/nope");
  assert.equal(res.status, 404);
  assert.match(res.headers.get("content-type"), /text\/markdown/);
  const body = await res.text();
  assert.match(body, /sitemap\.xml/);
  assert.match(body, /llms\.txt/);
});

test("API 404 and JSON clients get RFC 9457 problem details", async () => {
  for (const [path, headers] of [["/api/nope", {}], ["/v1/nope", {}], ["/nope", { Accept: "application/json" }]]) {
    const res = await get(path, headers);
    assert.equal(res.status, 404, path);
    assert.match(res.headers.get("content-type"), /application\/problem\+json/, path);
    const problem = await res.json();
    assert.equal(problem.status, 404);
    assert.equal(problem.title, "Not Found");
  }
});

test("fake OAuth token endpoint is gone", async () => {
  const res = await get("/oauth/token", { "Content-Type": "application/x-www-form-urlencoded" }, "POST");
  assert.equal(res.status, 404);
});

test("scan images get an immutable long cache", async () => {
  const res = await get("/assets/hero/x.webp");
  assert.equal(res.headers.get("cache-control"), "public, max-age=31536000, immutable");
});
