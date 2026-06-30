import { loadArticleBySlug, loadLibrary, loadMagazineBySlug } from "./store.mjs";
import { createProudMcpServerWithLoaders, proudToolDefinitions } from "./mcp-shared.mjs";

export { proudToolDefinitions };

export function createProudMcpServer() {
  return createProudMcpServerWithLoaders({
    loadLibrary,
    loadArticleBySlug,
    loadMagazineBySlug,
  });
}
