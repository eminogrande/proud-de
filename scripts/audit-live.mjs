#!/usr/bin/env node

const origin = normalizeOrigin(process.argv[2] ?? "https://proud.xn--wp9h.tk");

const getChecks = [
  ["/", "text/html"],
  ["/robots.txt", "text/plain"],
  ["/sitemap.xml", "xml"],
  ["/llms.txt", "text/plain"],
  ["/.well-known/api-catalog", "json"],
  ["/.well-known/mcp.json", "json"],
  ["/.well-known/mcp/server-card.json", "json"],
  ["/.well-known/agent-skills/index.json", "json"],
  ["/.well-known/webmcp.json", "json"],
  ["/.well-known/ai-catalog.json", "json"],
  ["/favicon.ico", "image/"],
  ["/.well-known/http-message-signatures-directory", "json"],
  ["/articles/vom-anfang-bis-zum/", "text/html"],
  ["/en/articles/vom-anfang-bis-zum/", "text/html"],
  ["/api/search?q=techno&limit=2", "json"],
  ["/api/authors.json", "json"],
  // Editorial pages (de + en) and author pages.
  ...["about", "masthead", "standards", "press", "corrections", "archive-guide", "authors", "authors/moritz-stellmacher", "authors/lukas-kampfmann"]
    .flatMap((key) => [[`/${key}/`, "text/html"], [`/en/${key}/`, "text/html"], [`/${key}/index.md`, "text/markdown"]]),
];

// Honesty rules: these strings must not appear on any of the checked pages (and are tested in site/ by npm test).
const bannedPatterns = [/(DFJV|Fachjournalisten)[^.]{0,80}(anerkannt|ausgezeichnet|recogni[sz]ed|award|honou?red|mehrfach)/i, /dfjv\.de/i, /1[.,]5\s*(million|Millionen|Mio)/i, /650[.,]000/, ...(process.env.PROUD_ISSN ? [] : [/\bISSN\b/])];
const honestyRoutes = ["/", "/en/", "/about/", "/en/about/", "/press/", "/en/press/", "/masthead/", "/authors/moritz-stellmacher/", "/articles/love-in-berlin/", "/llms.txt"];

const requiredHtmlSnippets = [
  ["/articles/vom-anfang-bis-zum/", "proud #01"],
  ["/articles/vom-anfang-bis-zum/", "Deutsch"],
  ["/en/articles/vom-anfang-bis-zum/", "English"],
  ["/articles/love-in-berlin/", "Lukas Kampfmann"],
  ["/en/articles/love-in-berlin/", "By <a"],
  ["/", "Z 2009 B 1863"],
  ["/masthead/", "Richard Kirschstein"],
  ["/press/", "DFJV-News vom 7. Mai 2009"],
  ["/about/", "Herausgeber heute: Emin Mahrt"],
];

let failures = 0;

for (const [route, expected] of getChecks) {
  await checkGet(route, expected);
}

await checkMarkdownNegotiation("/articles/vom-anfang-bis-zum/");
await checkVaryAccept("/");
await checkNotFound("/nope-audit-probe", "text/markdown");
await checkNotFound("/api/nope-audit-probe", "application/problem+json");
await checkNotFound("/oauth/token", "application/problem+json");

for (const [route, snippet] of requiredHtmlSnippets) {
  await checkSnippet(route, snippet);
}

for (const route of honestyRoutes) {
  await checkHonesty(route);
}

await checkPageSpeed();

if (failures > 0) {
  console.error(`\nAudit failed: ${failures} check(s) failed.`);
  process.exit(1);
}

console.log("\nAudit passed: core live endpoints are reachable.");

function normalizeOrigin(value) {
  return String(value).replace(/\/+$/, "");
}

function urlFor(route) {
  return `${origin}${route}`;
}

async function checkGet(route, expected) {
  try {
    const response = await fetch(urlFor(route), {
      headers: { "User-Agent": "proud-live-audit/1.0" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const ok = response.ok && matchesContentType(contentType, expected);
    report(ok, "GET", route, `${response.status} ${contentType}`);
  } catch (error) {
    report(false, "GET", route, error.message);
  }
}

async function checkMarkdownNegotiation(route) {
  try {
    const response = await fetch(urlFor(route), {
      headers: {
        Accept: "text/markdown",
        "User-Agent": "proud-live-audit/1.0",
      },
    });
    const text = await response.text();
    report(response.ok && text.includes("# Vom Anfang bis zum"), "MD", route, `${response.status}`);
  } catch (error) {
    report(false, "MD", route, error.message);
  }
}

async function checkVaryAccept(route) {
  try {
    const response = await fetch(urlFor(route), { headers: { "User-Agent": "proud-live-audit/1.0" } });
    const vary = response.headers.get("vary") ?? "";
    report(response.ok && /accept/i.test(vary), "VARY", route, vary || "missing");
  } catch (error) {
    report(false, "VARY", route, error.message);
  }
}

async function checkNotFound(route, expectedType) {
  try {
    const response = await fetch(urlFor(route), { headers: { "User-Agent": "proud-live-audit/1.0" } });
    const contentType = response.headers.get("content-type") ?? "";
    const body = await response.text();
    report(response.status === 404 && contentType.includes(expectedType) && body.length > 0, "404", route, `${response.status} ${contentType}`);
  } catch (error) {
    report(false, "404", route, error.message);
  }
}

async function checkSnippet(route, snippet) {
  try {
    const response = await fetch(urlFor(route), {
      headers: { "User-Agent": "proud-live-audit/1.0" },
    });
    const html = await response.text();
    report(response.ok && html.includes(snippet), "HTML", route, `contains "${snippet}"`);
  } catch (error) {
    report(false, "HTML", route, error.message);
  }
}

async function checkHonesty(route) {
  try {
    const response = await fetch(urlFor(route), { headers: { "User-Agent": "proud-live-audit/1.0" } });
    const text = await response.text();
    const hits = bannedPatterns.filter((pattern) => pattern.test(text)).map(String);
    report(response.ok && hits.length === 0, "HONEST", route, hits.length ? `found ${hits.join(", ")}` : "no banned claims");
  } catch (error) {
    report(false, "HONEST", route, error.message);
  }
}

async function checkPageSpeed() {
  const api = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
  api.searchParams.set("url", origin);
  api.searchParams.set("strategy", "mobile");
  for (const category of ["performance", "accessibility", "best-practices", "seo"]) {
    api.searchParams.append("category", category);
  }

  try {
    const response = await fetch(api, {
      headers: { "User-Agent": "proud-live-audit/1.0" },
    });
    const json = await response.json();
    if (!response.ok) {
      report(true, "PSI", "/", `skipped: ${json?.error?.message ?? response.status}`);
      return;
    }

    for (const [name, result] of Object.entries(json.lighthouseResult?.categories ?? {})) {
      const score = Math.round(Number(result.score ?? 0) * 100);
      report(score === 100, "PSI", name, `${score}`);
    }
  } catch (error) {
    report(true, "PSI", "/", `skipped: ${error.message}`);
  }
}

function matchesContentType(contentType, expected) {
  if (expected === "json") return contentType.includes("json");
  if (expected === "xml") return contentType.includes("xml");
  return contentType.includes(expected);
}

function report(ok, method, target, detail) {
  const mark = ok ? "ok" : "fail";
  console.log(`${mark.padEnd(4)} ${method.padEnd(5)} ${target} ${detail}`);
  if (!ok) failures += 1;
}
