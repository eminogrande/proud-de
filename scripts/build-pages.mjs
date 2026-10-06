#!/usr/bin/env node
// Copy the committed static export (site/) into a GitHub Pages artifact dir,
// re-hosting it under PAGES_ORIGIN + PAGES_BASE_PATH. LFS-free, no rebuild.
//   Project Pages: PAGES_ORIGIN=https://eminogrande.github.io PAGES_BASE_PATH=/proud-de
//   Custom domain: PAGES_ORIGIN=https://proud.de PAGES_BASE_PATH= (plus CNAME)
import fs from "node:fs/promises";
import path from "node:path";

const SOURCE_ORIGIN = process.env.SOURCE_ORIGIN ?? "https://proud.xn--wp9h.tk";
const origin = (process.env.PAGES_ORIGIN ?? "https://eminogrande.github.io").replace(/\/+$/, "");
const base = (process.env.PAGES_BASE_PATH ?? "/proud-de").replace(/\/+$/, "");
const cname = process.env.PAGES_CNAME ?? ""; // optional; Actions deploys use the repo setting
const src = path.resolve(process.argv[2] ?? "site");
const out = path.resolve(process.argv[3] ?? "_pages");

// Sitemap <lastmod>: last commit touching site/ (set in CI), else today.
const LASTMOD = process.env.PAGES_LASTMOD || new Date().toISOString().slice(0, 10);
const TEXT = /\.(html|md|txt|xml|json|css|js)$|\/\.well-known\/[^/.]+$/;

function rewrite(file, body) {
  body = body.split(SOURCE_ORIGIN).join(origin + base);
  body = body.split(new URL(SOURCE_ORIGIN).host).join(new URL(origin).host);
  if (file === "sitemap.xml") body = body.replace(/<\/loc><\/url>/g, `</loc><lastmod>${LASTMOD}</lastmod></url>`);
  if (!base) return body;
  if (file.endsWith(".html")) {
    body = body.replace(/\b(href|src|action|poster)="\/(?!\/)/g, `$1="${base}/`);
    body = body.replace(/\bsrcset="([^"]*)"/g, (_, v) => `srcset="${v.replace(/(^|,\s*)\/(?!\/)/g, `$1${base}/`)}"`);
  }
  if (file.endsWith(".md") || file.endsWith(".txt")) {
    body = body.replace(/\]\(\/(?!\/)/g, `](${base}/`);
  }
  if (file === ".well-known/agent-skills/index.json") {
    body = body.replace(/("url"\s*:\s*")\/(?=\.well-known\/agent-skills\/)/g, `$1${base}/`);
  }
  if (file.endsWith(".css")) body = body.replace(/url\((["']?)\/(?!\/)/g, `url($1${base}/`);
  return body;
}

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const from = path.join(dir, entry.name);
    const rel = path.relative(src, from);
    const to = path.join(out, rel);
    if (entry.isDirectory()) { await fs.mkdir(to, { recursive: true }); await walk(from); continue; }
    if (rel === "_headers" || rel === ".gitkeep") continue; // Cloudflare-only
    if (TEXT.test("/" + rel.split(path.sep).join("/"))) {
      await fs.writeFile(to, rewrite(rel, await fs.readFile(from, "utf8")));
    } else {
      await fs.copyFile(from, to);
    }
  }
}

await fs.rm(out, { recursive: true, force: true });
await fs.mkdir(out, { recursive: true });
await walk(src);
await fs.writeFile(path.join(out, ".nojekyll"), "");
if (cname) await fs.writeFile(path.join(out, "CNAME"), cname + "\n");
console.log(`pages: ${src} -> ${out} as ${origin}${base}/`);
