import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createProudMcpServerWithLoaders } from "../src/lib/mcp-shared.mjs";
import { formatSearchResults } from "../src/lib/search.mjs";

const COMMON_LINK_HEADERS = [
  "</sitemap.xml>; rel=\"sitemap\"",
  "</.well-known/api-catalog>; rel=\"api-catalog\"",
  "</.well-known/agent-skills/index.json>; rel=\"agent-skills\"",
  "</.well-known/webmcp.json>; rel=\"webmcp\"",
  "</.well-known/mcp/server-card.json>; rel=\"mcp-server\"",
  "</.well-known/ai-catalog.json>; rel=\"ai-catalog\"; type=\"application/json\"",
];

const STATIC_CONTENT_TYPES = new Map([
  ["/.well-known/api-catalog", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'],
  ["/.well-known/http-message-signatures-directory", "application/http-message-signatures-directory+json"],
]);

const STATIC_ROUTE_ASSETS = new Map([
  ["/.well-known/api-catalog", "/.well-known/api-catalog"],
  ["/.well-known/http-message-signatures-directory", "/.well-known/http-message-signatures-directory/index.json"],
]);

// Long-lived, content-addressed-by-slug image trees. HTML/Markdown stay short so edits show up quickly.
const IMMUTABLE_ASSET_PREFIXES = ["/assets/fonts/", "/assets/hero/", "/assets/hero-800/", "/assets/previews/", "/assets/page-images/", "/assets/page-images-760/"];
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DOCUMENT_CACHE_CONTROL = "public, max-age=300, must-revalidate";

const jsonCache = new Map();

function wantsMarkdown(request) {
  return String(request.headers.get("accept") ?? "").includes("text/markdown");
}

function altMarkdownPath(routePath) {
  const clean = routePath === "/" ? "/" : routePath.endsWith("/") ? routePath : `${routePath}/`;
  return clean === "/" ? "/index.md" : `${clean}index.md`;
}

function addCommonHeaders(headers) {
  headers.set("X-Robots-Tag", "all");
  const existingLinks = headers.get("Link") ?? "";
  for (const value of COMMON_LINK_HEADERS) {
    if (!existingLinks.includes(value)) {
      headers.append("Link", value);
    }
  }
}

function withCommonHeaders(response, headersToSet = {}) {
  const headers = new Headers(response.headers);
  addCommonHeaders(headers);
  for (const [name, value] of Object.entries(headersToSet)) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function jsonResponse(payload, init = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  addCommonHeaders(headers);
  return new Response(init.method === "HEAD" ? null : JSON.stringify(payload, null, 2), {
    status: init.status ?? 200,
    headers,
  });
}

function methodNotAllowed(allow) {
  return jsonResponse(
    {
      error: "Method Not Allowed",
    },
    {
      status: 405,
      headers: {
        Allow: allow,
      },
    },
  );
}

function optionsResponse(allow) {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: allow,
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": allow,
      "Access-Control-Allow-Headers": "Accept, Content-Type, MCP-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function parseLimit(value, fallback) {
  const numeric = Number.parseInt(value ?? `${fallback}`, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(1, Math.min(50, numeric));
}

async function fetchAsset(env, request, assetPath) {
  const url = new URL(assetPath, request.url);
  return env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
}

function prefersJson(request) {
  const accept = String(request.headers.get("accept") ?? "").toLowerCase();
  return /application\/(?:problem\+)?json/.test(accept) && !accept.includes("text/html");
}

function isApiPath(pathname) {
  return /^\/(?:api|v\d+)(?:\/|$)/.test(pathname) || pathname === "/graphql";
}

// RFC 9457 problem details for API paths and JSON clients; short Markdown recovery page otherwise.
function notFoundResponse(request) {
  const url = new URL(request.url);
  const headers = new Headers({ "Cache-Control": "no-store", Vary: "Accept" });
  addCommonHeaders(headers);
  if (isApiPath(url.pathname) || prefersJson(request)) {
    headers.set("Content-Type", "application/problem+json; charset=utf-8");
    headers.set("Access-Control-Allow-Origin", "*");
    const problem = {
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: `No resource exists at ${url.pathname}.`,
      instance: url.pathname,
      documentation: `${url.origin}/api/openapi.json`,
    };
    return new Response(request.method === "HEAD" ? null : JSON.stringify(problem, null, 2), { status: 404, headers });
  }
  headers.set("Content-Type", "text/markdown; charset=utf-8");
  const body = `# 404: page not found

There is no page at \`${url.pathname}\` in the proud archive.

- [Front page](${url.origin}/)
- [All articles](${url.origin}/articles/)
- [Sitemap](${url.origin}/sitemap.xml)
- [llms.txt](${url.origin}/llms.txt)
- [Search API](${url.origin}/api/search?q=berlin)
`;
  return new Response(request.method === "HEAD" ? null : body, { status: 404, headers });
}

function cacheControlFor(pathname, contentType) {
  if (IMMUTABLE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  if (/text\/(?:html|markdown)/.test(contentType)) {
    return DOCUMENT_CACHE_CONTROL;
  }
  return null;
}

function withAltMarkdownLink(response, request) {
  const headers = new Headers(response.headers);
  addCommonHeaders(headers);
  const pathname = new URL(request.url).pathname;
  const contentType = String(headers.get("content-type") ?? "");
  if (contentType.includes("text/html")) {
    headers.append("Link", `<${altMarkdownPath(pathname)}>; rel="alternate"; type="text/markdown"`);
    headers.set("Vary", "Accept");
  }
  const cacheControl = response.ok ? cacheControlFor(pathname, contentType) : null;
  if (cacheControl) {
    headers.set("Cache-Control", cacheControl);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleStaticRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname.startsWith("/assets/pdfs/")) {
    if (!env.PDFS_BUCKET) {
      return new Response("PDF bucket not configured", { status: 404 });
    }

    const key = decodeURIComponent(url.pathname.replace(/^\/assets\/pdfs\//, ""));
    const object = await env.PDFS_BUCKET.get(key, {
      range: request.headers,
      onlyIf: request.headers,
    });

    if (!object) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    headers.set("accept-ranges", "bytes");
    headers.set("content-type", headers.get("content-type") ?? "application/pdf");
    addCommonHeaders(headers);

    if (request.method === "HEAD") {
      return new Response(null, {
        status: "range" in object ? 206 : 200,
        headers,
      });
    }

    return new Response(object.body, {
      status: "range" in object ? 206 : 200,
      headers,
    });
  }

  if (url.pathname === "/.well-known/mcp.json") {
    const response = await fetchAsset(env, request, "/.well-known/mcp.json");
    return withCommonHeaders(response, {
      "Content-Type": "application/json; charset=utf-8",
    });
  }

  if (url.pathname === "/.well-known/ai-catalog.json") {
    const response = await fetchAsset(env, request, url.pathname);
    return withCommonHeaders(response, {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
    });
  }

  if (STATIC_CONTENT_TYPES.has(url.pathname)) {
    const response = await fetchAsset(env, request, STATIC_ROUTE_ASSETS.get(url.pathname) ?? url.pathname);
    return withCommonHeaders(response, {
      "Content-Type": STATIC_CONTENT_TYPES.get(url.pathname),
    });
  }

  if (wantsMarkdown(request) && request.method !== "OPTIONS") {
    const markdownResponse = await fetchAsset(env, request, altMarkdownPath(url.pathname));
    if (markdownResponse.ok) {
      return withCommonHeaders(markdownResponse, {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": DOCUMENT_CACHE_CONTROL,
        Vary: "Accept",
      });
    }
  }

  const response = await env.ASSETS.fetch(request);
  if (response.status === 404) {
    return notFoundResponse(request);
  }
  return withAltMarkdownLink(response, request);
}

async function readCachedJsonAsset(env, request, assetPath) {
  if (!jsonCache.has(assetPath)) {
    const pending = (async () => {
      const response = await fetchAsset(env, request, assetPath);
      if (!response.ok) {
        throw new Error(`Static asset unavailable: ${assetPath} (${response.status})`);
      }
      return response.json();
    })().catch((error) => {
      jsonCache.delete(assetPath);
      throw error;
    });
    jsonCache.set(assetPath, pending);
  }

  return jsonCache.get(assetPath);
}

async function readOptionalJsonAsset(env, request, assetPath) {
  const response = await fetchAsset(env, request, assetPath);
  if (response.status === 404) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Static asset unavailable: ${assetPath} (${response.status})`);
  }
  return response.json();
}

function createAssetLoaders(env, request) {
  return {
    loadLibrary: () => readCachedJsonAsset(env, request, "/api/library.json"),
    loadArticleBySlug: (slug) =>
      readOptionalJsonAsset(env, request, `/api/articles/${encodeURIComponent(slug)}.json`),
    loadMagazineBySlug: (slug) =>
      readOptionalJsonAsset(env, request, `/api/magazines/${encodeURIComponent(slug)}.json`),
  };
}

async function handleSearch(request, env) {
  if (request.method === "OPTIONS") {
    return optionsResponse("GET, HEAD, OPTIONS");
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed("GET, HEAD, OPTIONS");
  }

  const url = new URL(request.url);
  const query = url.searchParams.get("q") ?? "";
  const limit = parseLimit(url.searchParams.get("limit"), 10);
  const library = await readCachedJsonAsset(env, request, "/api/library.json");
  const results = formatSearchResults(library, query, { limit });

  return jsonResponse(
    { query, total: results.length, results },
    {
      method: request.method,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Link",
      },
    },
  );
}

async function handleMcp(request, env) {
  if (request.method === "OPTIONS") {
    return optionsResponse("POST, OPTIONS");
  }

  if (request.method !== "POST") {
    return methodNotAllowed("POST, OPTIONS");
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  const server = createProudMcpServerWithLoaders(createAssetLoaders(env, request));

  try {
    await server.connect(transport);
    const response = await transport.handleRequest(request);
    return withCommonHeaders(response, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Expose-Headers": "Link",
    });
  } finally {
    await Promise.allSettled([transport.close(), server.close()]);
  }
}

export default {
  async fetch(request, env) {
    const routePath = decodeURIComponent(new URL(request.url).pathname);

    if (routePath === "/api/search") {
      return handleSearch(request, env);
    }

    if (routePath === "/mcp") {
      return handleMcp(request, env);
    }

    return handleStaticRequest(request, env);
  },
};
