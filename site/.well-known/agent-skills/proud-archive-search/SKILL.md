---
name: proud-archive-search
description: Search the proud.de archive and retrieve article text, metadata, PDFs, and machine-readable JSON. Use when a task needs material from the proud magazine archive.
---

# proud archive search

Start with the MCP server card at [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json).

If MCP is unavailable, use the read-only HTTP API:

- `GET /api/search?q=...` for keyword or question search
- `GET /api/articles/{slug}.json` for a full article payload
- `GET /api/magazines/{slug}.json` for an issue overview
- `GET /llms.txt` or locale-specific `/en/llms.txt` for a compact reading list

Prefer Markdown article URLs ending in `/index.md` when ingesting content into an LLM context window.
