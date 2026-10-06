import { randomUUID } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { ensureWorkspace } from "./lib/config.mjs";
import { createProudMcpServer } from "./lib/mcp-core.mjs";
import { formatSearchResults } from "./lib/search.mjs";
import { loadLibrary } from "./lib/store.mjs";

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".pdf", "application/pdf"],
]);

const COMMON_LINK_HEADERS = [
  "</sitemap.xml>; rel=\"sitemap\"",
  "</.well-known/api-catalog>; rel=\"api-catalog\"",
  "</.well-known/agent-skills/index.json>; rel=\"agent-skills\"",
  "</.well-known/webmcp.json>; rel=\"webmcp\"",
  "</.well-known/mcp/server-card.json>; rel=\"mcp-server\"",
];

const ROUTE_CONTENT_TYPES = new Map([
  ["/.well-known/api-catalog", 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"'],
  ["/.well-known/http-message-signatures-directory", "application/http-message-signatures-directory+json"],
]);

const ROUTE_STATIC_FILES = new Map([
  ["/.well-known/http-message-signatures-directory", "/.well-known/http-message-signatures-directory/index.json"],
]);

function wantsMarkdown(req) {
  return String(req.headers.accept ?? "").includes("text/markdown");
}

function extType(filePath) {
  return MIME_TYPES.get(path.extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function addCommonHeaders(res) {
  res.setHeader("X-Robots-Tag", "all");
  res.setHeader("Link", COMMON_LINK_HEADERS);
}

function safeFilePath(root, target) {
  const resolved = path.resolve(root, `.${target}`);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

async function fileExists(filePath) {
  try {
    const stat = await fsp.stat(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function withAltMarkdownHeader(res, routePath) {
  const clean = routePath === "/" ? "/" : routePath.endsWith("/") ? routePath : `${routePath}/`;
  const existing = res.getHeader("Link");
  const links = Array.isArray(existing) ? existing : existing ? [existing] : [];
  const altPath = clean === "/" ? "/index.md" : `${clean}index.md`;
  links.push(`<${altPath}>; rel="alternate"; type="text/markdown"`);
  res.setHeader("Link", links);
}

async function resolveStaticFile(site, routePath, req) {
  if (ROUTE_STATIC_FILES.has(routePath)) {
    const mapped = safeFilePath(site.paths.siteOutputDir, ROUTE_STATIC_FILES.get(routePath));
    if (mapped && await fileExists(mapped)) {
      return mapped;
    }
  }

  if (routePath.startsWith("/assets/pdfs/")) {
    const pdfName = path.basename(routePath);
    const pdfPath = path.join(site.paths.pdfInputDir, pdfName);
    if (await fileExists(pdfPath)) {
      return pdfPath;
    }
  }

  if (routePath.startsWith("/assets/page-images/")) {
    const relative = routePath.replace(/^\/assets\//, "");
    const pageImagePath = path.join(site.paths.outputDir, relative);
    if (await fileExists(pageImagePath)) {
      return pageImagePath;
    }
  }

  const siteDir = site.paths.siteOutputDir;
  const direct = safeFilePath(siteDir, routePath);
  const acceptMarkdown = wantsMarkdown(req);
  const normalized = routePath.endsWith("/") ? routePath : `${routePath}/`;

  const candidates = [];
  if (acceptMarkdown) {
    candidates.push(safeFilePath(siteDir, `${normalized}index.md`));
  }
  candidates.push(safeFilePath(siteDir, `${normalized}index.html`));
  if (!acceptMarkdown) {
    candidates.push(safeFilePath(siteDir, `${normalized}index.md`));
  }
  if (direct) {
    candidates.unshift(direct);
  }

  for (const candidate of candidates.filter(Boolean)) {
    if (await fileExists(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function serveFile(res, filePath, req, routePath) {
  const contentType = ROUTE_CONTENT_TYPES.get(routePath) ?? extType(filePath);
  res.statusCode = 200;
  res.setHeader("Content-Type", contentType);
  addCommonHeaders(res);

  if (filePath.endsWith("index.html")) {
    withAltMarkdownHeader(res, routePath);
  }

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  fs.createReadStream(filePath).pipe(res);
}

async function readTextBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function readJsonBody(req) {
  const body = await readTextBody(req);
  return body ? JSON.parse(body) : {};
}

async function handleSearchApi(req, res) {
  const requestUrl = new URL(req.url, "http://localhost");
  const query = requestUrl.searchParams.get("q") ?? "";
  const limit = Number.parseInt(requestUrl.searchParams.get("limit") ?? "10", 10);
  const library = await loadLibrary();
  const results = formatSearchResults(library, query, { limit: Number.isFinite(limit) ? limit : 10 });

  res.statusCode = 200;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  addCommonHeaders(res);
  res.end(JSON.stringify({ query, total: results.length, results }, null, 2));
}

async function main() {
  const site = await ensureWorkspace();
  const siteDir = site.paths.siteOutputDir;
  const mcpTransports = new Map();
  const port = Number.parseInt(process.env.PORT ?? "8787", 10);

  const server = http.createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);
      const routePath = decodeURIComponent(requestUrl.pathname);

      if (routePath === "/api/search") {
        if (req.method !== "GET" && req.method !== "HEAD") {
          res.statusCode = 405;
          res.setHeader("Allow", "GET, HEAD");
          res.end("Method Not Allowed");
          return;
        }

        await handleSearchApi(req, res);
        return;
      }

      if (routePath === "/mcp") {
        if (req.method === "GET") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST, DELETE");
          res.end("Method Not Allowed");
          return;
        }

        if (req.method === "DELETE") {
          const sessionId = req.headers["mcp-session-id"];
          if (!sessionId || !mcpTransports.has(sessionId)) {
            res.statusCode = 400;
            res.end("Invalid or missing session ID");
            return;
          }

          await mcpTransports.get(sessionId).handleRequest(req, res);
          return;
        }

        if (req.method !== "POST") {
          res.statusCode = 405;
          res.setHeader("Allow", "POST, DELETE");
          res.end("Method Not Allowed");
          return;
        }

        const body = await readJsonBody(req);
        const sessionId = req.headers["mcp-session-id"];
        let transport = sessionId ? mcpTransports.get(sessionId) : null;

        if (!transport) {
          if (!isInitializeRequest(body)) {
            res.statusCode = 400;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(
              JSON.stringify({
                jsonrpc: "2.0",
                error: { code: -32000, message: "Bad Request: No valid session ID provided" },
                id: null,
              }),
            );
            return;
          }

          transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            enableJsonResponse: true,
            onsessioninitialized: (createdSessionId) => {
              mcpTransports.set(createdSessionId, transport);
            },
          });
          transport.onclose = () => {
            if (transport.sessionId) {
              mcpTransports.delete(transport.sessionId);
            }
          };

          const mcpServer = createProudMcpServer();
          await mcpServer.connect(transport);
        }

        await transport.handleRequest(req, res, body);
        return;
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
        res.statusCode = 405;
        res.setHeader("Allow", "GET, HEAD");
        res.end("Method Not Allowed");
        return;
      }

      const filePath = await resolveStaticFile(site, routePath, req);
      if (!filePath) {
        res.statusCode = 404;
        addCommonHeaders(res);
        res.end("Not Found");
        return;
      }

      await serveFile(res, filePath, req, routePath);
    } catch (error) {
      console.error(error);
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader("Content-Type", "text/plain; charset=utf-8");
      }
      res.end("Internal Server Error");
    }
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`proud site + MCP server listening on http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
