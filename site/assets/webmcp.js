// WebMCP: expose the existing read-only archive endpoints as in-page tools.
(() => {
  const modelContext = document.modelContext ?? navigator.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== "function") return;
  const root = new URL("..", document.currentScript?.src ?? location.href);
  const getJson = async (route) => {
    const response = await fetch(new URL(route, root), { headers: { Accept: "application/json" } });
    const body = await response.json();
    if (!response.ok) throw new Error(body.detail ?? body.title ?? String(response.status));
    return { content: [{ type: "text", text: JSON.stringify(body) }] };
  };
  const tools = [
    {
      name: "search_archive",
      description: "Search proud magazine archive articles by keyword. Returns slug, title, snippet and page span.",
      inputSchema: { type: "object", properties: { q: { type: "string", description: "Search query" }, limit: { type: "integer", minimum: 1, maximum: 50 } }, required: ["q"] },
      annotations: { readOnlyHint: true },
      execute: ({ q, limit }) => getJson("api/search?" + new URLSearchParams({ q: String(q), limit: String(limit ?? 10) })),
    },
    {
      name: "get_article",
      description: "Get the full structured JSON (text, issue, pages, scans) of one proud article by slug.",
      inputSchema: { type: "object", properties: { slug: { type: "string" } }, required: ["slug"] },
      annotations: { readOnlyHint: true },
      execute: ({ slug }) => getJson("api/articles/" + encodeURIComponent(String(slug)) + ".json"),
    },
  ];
  for (const tool of tools) {
    try {
      const result = modelContext.registerTool(tool);
      if (result && typeof result.catch === "function") result.catch(() => {});
    } catch (_error) {
      // Tool already registered or API shape differs; the page works without it.
    }
  }
})();
