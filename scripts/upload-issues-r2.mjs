// Upload issue binaries to the proud-preview-pdfs R2 bucket.
// Dry run unless --execute is passed. Only keys the Worker allowlist accepts are
// uploaded, so review/ and _state/ never leave the disk.
//
//   node scripts/upload-issues-r2.mjs --dir ABS [--only 24] [--execute] [--force]
//   node scripts/upload-issues-r2.mjs --dir ABS --verify https://example.org
//
// Credentials come from the environment only (CLOUDFLARE_API_TOKEN etc).
// Never reads .env.local, never prints env values.

import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { issueCacheControl, parseIssueAsset } from "../src/lib/issues-route.mjs";

const BUCKET = "proud-preview-pdfs";
const CACHE_CONTROL = issueCacheControl(false);
const CONCURRENCY = 4;

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    fs.createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });
}

async function collectObjects(dir, only) {
  const issueDirs = (await fsp.readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && /^[0-9]{2}$/.test(entry.name))
    .filter((entry) => !only || entry.name === only)
    .map((entry) => entry.name)
    .sort();

  const objects = [];
  for (const issue of issueDirs) {
    const pagesDir = path.join(dir, issue, "pages");
    const pageNames = (await fsp.readdir(pagesDir).catch(() => [])).sort();
    for (const name of pageNames) {
      const asset = parseIssueAsset(`/assets/issues/${issue}/pages/${name}`);
      if (!asset) continue;
      const file = path.join(pagesDir, name);
      objects.push({ file, asset, bytes: (await fsp.stat(file)).size });
    }

    const pdfFile = path.join(dir, issue, `proud-${issue}.pdf`);
    const pdfStat = await fsp.stat(pdfFile).catch(() => null);
    if (pdfStat?.isFile()) {
      objects.push({ file: pdfFile, asset: parseIssueAsset(`/assets/issues/${issue}/proud-${issue}.pdf`), bytes: pdfStat.size });
    }
  }

  return objects;
}

function putObject({ file, asset }) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["--no-install", "wrangler", "r2", "object", "put", `${BUCKET}/${asset.key}`, "--file", file, "--content-type", asset.contentType, "--cache-control", CACHE_CONTROL, "--remote"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`wrangler exit ${code} for ${asset.key}: ${stderr.trim().split("\n").pop() ?? ""}`));
    });
  });
}

async function pool(items, limit, worker) {
  const queue = [...items];
  const runners = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      await worker(item);
    }
  });
  await Promise.all(runners);
}

async function runUploads(objects, ledgerPath) {
  const ledger = JSON.parse(await fsp.readFile(ledgerPath, "utf8").catch(() => "{}"));
  const force = process.argv.includes("--force");
  const todo = [];

  for (const object of objects) {
    const sha256 = await sha256File(object.file);
    object.sha256 = sha256;
    const known = ledger[object.asset.key];
    if (!force && known && known.sha256 === sha256 && known.bytes === object.bytes) {
      console.log(`skip unchanged ${object.asset.key}`);
      continue;
    }
    todo.push(object);
  }

  let done = 0;
  await pool(todo, CONCURRENCY, async (object) => {
    await putObject(object);
    ledger[object.asset.key] = { bytes: object.bytes, sha256: object.sha256 };
    await fsp.mkdir(path.dirname(ledgerPath), { recursive: true });
    await fsp.writeFile(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
    done += 1;
    console.log(`put ${object.asset.key} ${done}/${todo.length}`);
  });
}

async function runVerify(objects, origin) {
  let ok = 0;
  for (const object of objects) {
    const response = await fetch(`${origin}/assets/issues/${object.asset.relative}`, { method: "HEAD" });
    const length = Number(response.headers.get("content-length"));
    const good = (response.status === 200 || response.status === 206) && length === object.bytes;
    if (good) ok += 1;
    else console.log(`MISMATCH ${object.asset.key} status=${response.status} length=${length} expected=${object.bytes}`);
  }
  console.log(`${ok} of ${objects.length} OK`);
  return ok === objects.length;
}

async function main() {
  const dirArg = argValue("--dir");
  if (!dirArg) {
    console.error("usage: node scripts/upload-issues-r2.mjs --dir ABS [--only 24] [--execute] [--force] [--verify ORIGIN]");
    process.exit(2);
  }

  const dir = path.resolve(dirArg);
  const stat = await fsp.stat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    console.error(`not a directory: ${dir}`);
    process.exit(2);
  }

  const only = argValue("--only");
  const objects = await collectObjects(dir, only);
  const totalBytes = objects.reduce((sum, object) => sum + object.bytes, 0);
  const execute = process.argv.includes("--execute");

  for (const object of objects) {
    console.log(`${object.asset.key} ${object.bytes} ${object.asset.contentType} ${CACHE_CONTROL}`);
  }
  console.log(`total ${objects.length} objects, ${(totalBytes / 1e9).toFixed(3)} GB`);

  if (execute) {
    await runUploads(objects, path.join(dir, "_state", "uploaded.json"));
  } else {
    console.log("dry run: nothing uploaded, no network call");
  }

  const origin = argValue("--verify");
  if (origin) {
    const good = await runVerify(objects, origin.replace(/\/$/, ""));
    if (!good) process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
