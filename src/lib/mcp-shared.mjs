import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { formatSearchResults } from "./search.mjs";

function asTextResult(payload) {
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(payload, null, 2),
      },
    ],
  };
}

function takeNumber(value, fallback, min = 1, max = 50) {
  const numeric = Number.parseInt(value ?? `${fallback}`, 10);
  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.min(max, Math.max(min, numeric));
}

export function proudToolDefinitions() {
  return [
    {
      name: "list_magazines",
      description: "Listet alle bekannten proud-magazine mit Basis-Metadaten auf.",
      inputSchema: {
        type: "object",
        properties: {
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: "list_articles",
      description: "Listet Artikel auf, optional gefiltert nach einem Magazin-Slug.",
      inputSchema: {
        type: "object",
        properties: {
          magazineSlug: {
            type: "string",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 100,
          },
        },
      },
    },
    {
      name: "search_articles",
      description: "Durchsucht den Volltextbestand von proud nach Stichworten oder Themen.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Suchbegriff oder Frage, zum Beispiel 'Berlin Clubkultur'.",
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 25,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_article",
      description: "Lädt einen einzelnen Artikel samt Markdown-Text und Metadaten.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
          },
        },
        required: ["slug"],
      },
    },
    {
      name: "get_magazine",
      description: "Lädt ein einzelnes Magazin samt Artikelliste und Metadaten.",
      inputSchema: {
        type: "object",
        properties: {
          slug: {
            type: "string",
          },
        },
        required: ["slug"],
      },
    },
  ];
}

export function createProudMcpServerWithLoaders(loaders) {
  const server = new Server(
    {
      name: "proud-archive",
      version: "0.2.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: proudToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const library = await loaders.loadLibrary();
    const { name, arguments: args = {} } = request.params;

    switch (name) {
      case "list_magazines": {
        const limit = takeNumber(args.limit, 20, 1, 100);
        return asTextResult({
          total: library.magazines.length,
          magazines: library.magazines.slice(0, limit),
        });
      }

      case "list_articles": {
        const limit = takeNumber(args.limit, 20, 1, 100);
        const articles = args.magazineSlug
          ? library.articles.filter((article) => article.magazineSlug === args.magazineSlug)
          : library.articles;
        return asTextResult({
          total: articles.length,
          articles: articles.slice(0, limit),
        });
      }

      case "search_articles": {
        const limit = takeNumber(args.limit, 10, 1, 25);
        const results = formatSearchResults(library, args.query ?? "", { limit });
        return asTextResult({
          query: args.query ?? "",
          total: results.length,
          results,
        });
      }

      case "get_article": {
        const article = await loaders.loadArticleBySlug(args.slug);
        return asTextResult(
          article
            ? article
            : {
                error: `Artikel nicht gefunden: ${args.slug}`,
              },
        );
      }

      case "get_magazine": {
        const magazine = await loaders.loadMagazineBySlug(args.slug);
        return asTextResult(
          magazine
            ? magazine
            : {
                error: `Magazin nicht gefunden: ${args.slug}`,
              },
        );
      }

      default:
        return asTextResult({
          error: `Unbekanntes Tool: ${name}`,
        });
    }
  });

  return server;
}
