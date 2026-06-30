import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createProudMcpServer } from "./lib/mcp-core.mjs";

async function main() {
  const server = createProudMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
