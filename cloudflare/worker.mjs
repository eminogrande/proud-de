import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createProudMcpServerWithLoaders } from "../src/lib/mcp-shared.mjs";
import { formatSearchResults } from "../src/lib/search.mjs";

const COMMON_LINK_HEADERS = [
  "</sitemap.xml>; rel=\"sitemap\"",
  "</.well-known/api-catalog>; rel=\"api-catalog\"",
  "</.well-known/agent-skills/index.json>; rel=\"agent-skills\"",
  "</.well-known/webmcp.json>; rel=\"webmcp\"",
  "</.well-known/mcp/server-card.json>; rel=\"mcp-server\"",
];

const STATIC_CONTENT_TYPES = new Map([
  ["/.well-known/api-catalog", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'],
  ["/.well-known/oauth-authorization-server", "application/json; charset=utf-8"],
  ["/.well-known/oauth-protected-resource", "application/json; charset=utf-8"],
  ["/.well-known/oauth-protected-resource/mcp", "application/json; charset=utf-8"],
  ["/.well-known/http-message-signatures-directory", "application/http-message-signatures-directory+json"],
]);

const STATIC_ROUTE_ASSETS = new Map([
  ["/.well-known/api-catalog", "/.well-known/api-catalog"],
  ["/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/index.json"],
  ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/index.json"],
  ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource/mcp.json"],
  ["/.well-known/http-message-signatures-directory", "/.well-known/http-message-signatures-directory/index.json"],
]);

const SUPPORTED_OAUTH_SCOPES = new Set(["archive.read", "search.read", "mcp.read"]);

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

async function readRequestFields(request) {
  const contentType = String(request.headers.get("content-type") ?? "");
  const bodyText = await request.text();

  if (!bodyText) {
    return new URLSearchParams();
  }

  if (contentType.includes("application/json")) {
    const payload = JSON.parse(bodyText);
    return new URLSearchParams(
      Object.entries(payload).flatMap(([key, value]) =>
        value == null ? [] : Array.isArray(value) ? value.map((item) => [key, String(item)]) : [[key, String(value)]],
      ),
    );
  }

  return new URLSearchParams(bodyText);
}

async function fetchAsset(env, request, assetPath) {
  const url = new URL(assetPath, request.url);
  return env.ASSETS.fetch(new Request(url.toString(), { method: "GET" }));
}

function withAltMarkdownLink(response, request) {
  const headers = new Headers(response.headers);
  addCommonHeaders(headers);
  if (String(headers.get("content-type") ?? "").includes("text/html")) {
    headers.append("Link", `<${altMarkdownPath(new URL(request.url).pathname)}>; rel="alternate"; type="text/markdown"`);
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
      });
    }
  }

  const response = await env.ASSETS.fetch(request);
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

async function handleOAuthToken(request) {
  if (request.method === "OPTIONS") {
    return optionsResponse("POST, OPTIONS");
  }

  if (request.method !== "POST") {
    return methodNotAllowed("POST, OPTIONS");
  }

  const fields = await readRequestFields(request);
  const grantType = fields.get("grant_type") ?? "";

  if (grantType !== "client_credentials") {
    return jsonResponse(
      {
        error: "unsupported_grant_type",
        error_description: "This public archive only supports the client_credentials grant for optional read-only tokens.",
      },
      {
        status: 400,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Expose-Headers": "Link",
          "Cache-Control": "no-store",
        },
      },
    );
  }

  const requestedScopes = String(fields.get("scope") ?? "")
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  const grantedScopes = requestedScopes.length > 0
    ? requestedScopes.filter((scope) => SUPPORTED_OAUTH_SCOPES.has(scope))
    : [...SUPPORTED_OAUTH_SCOPES];

  return jsonResponse(
    {
      access_token: `proud_${crypto.randomUUID().replace(/-/g, "")}`,
      token_type: "Bearer",
      expires_in: 3600,
      scope: grantedScopes.join(" "),
    },
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Expose-Headers": "Link",
        "Cache-Control": "no-store",
        Pragma: "no-cache",
      },
    },
  );
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

    if (routePath === "/oauth/token") {
      return handleOAuthToken(request);
    }

    return handleStaticRequest(request, env);
  },
};
