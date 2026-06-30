# proud.de archive engine

`proud.de` verarbeitet Magazin-PDFs lokal, extrahiert daraus einen strukturierten Archivbestand und veröffentlicht denselben Inhalt parallel als CLI, MCP, HTML, Markdown und JSON.

## Ziel

- PDFs aus einem Ordner einlesen
- Artikel pro Magazin automatisch erkennen
- Bei Bedarf manuelle Overrides per Manifest erlauben
- Volltextsuche über alle Artikel anbieten
- Artikel an Agents über MCP, `llms.txt`, JSON und Markdown ausliefern
- Einen öffentlichen Export für Suchmaschinen und AI-Agents erzeugen
- Mehrsprachige Ausspielung pro Artikel vorbereiten

## Struktur

- `config/site.json`: Stammdaten für `proud.de`
- `data/input/pdfs/`: rohe PDF-Dateien
- `data/input/manifests/`: optionale manuelle Artikeldefinitionen pro PDF
- `data/input/translations/<locale>/`: manuelle Übersetzungs-Overrides pro Artikel
- `data/output/`: erzeugte Bibliothek, Artikeldateien, Magazin-Metadaten und Vorschaubilder
- `data/output/page-images/`: Seitenscreenshots pro Artikel
- `site/`: generierter Public-Export
- `cloudflare/worker.mjs`: Cloudflare-Worker für `/api/search` und `/mcp` auf Basis des statischen Exports
- `wrangler.jsonc`: Deploy-Konfiguration für Cloudflare Workers mit Static Assets
- `scripts/ingest.mjs`: Node-Wrapper für die PDF-Verarbeitung
- `scripts/generate.mjs`: Orchestrator für Ingest, optionale Übersetzungen und Site-Build in einem Lauf
- `scripts/pdf_extract.py`: eigentliche PDF-Extraktion und Normalisierung
- `scripts/build-site.mjs`: erzeugt HTML, Markdown, JSON, Sitemap, `llms.txt` und Discovery-Dateien
- `scripts/scaffold-translations.mjs`: legt Übersetzungs-Skelette pro Sprache an
- `src/cli.mjs`: lokale Recherche über die Bibliothek
- `src/mcp-server.mjs`: MCP-Server über stdio
- `src/serve.mjs`: lokaler HTTP-Server mit statischem Export, Search-API und Remote-MCP unter `/mcp`

## Workflow

1. PDFs in `data/input/pdfs/` legen oder per `--input-dir` auf einen anderen Ordner zeigen.
2. Python-Umgebung installieren:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

3. Node-Abhängigkeiten installieren:

```bash
npm install
```

4. Optional lokale Secrets in `.env.local` hinterlegen:

```bash
cp .env.example .env.local
```

Für Cloud-OCR über OpenRouter:

```bash
OPENROUTER_API_KEY=...
PROUD_OCR_PROVIDER=openrouter-page
PROUD_OCR_OPENROUTER_MODEL=google/gemini-2.5-flash
PROUD_OCR_OPENROUTER_PDF_ENGINE=mistral-ocr
PROUD_ENABLE_AI_LAYOUT=0
```

5. Schnellster Komplettlauf für einen beliebigen PDF-Ordner:

```bash
npm run generate -- --input-dir "/pfad/zu/deinen/pdfs"
```

Mit englischer Testausgabe:

```bash
npm run generate -- --input-dir "/pfad/zu/deinen/pdfs" --translate en
```

Mit mehreren Sprachen:

```bash
npm run generate -- --input-dir "/pfad/zu/deinen/pdfs" --translate en,fr
```

Nur Übersetzung plus Neu-Build auf vorhandenem Bestand:

```bash
npm run generate -- --skip-ingest --translate en --refresh-translations
```

6. Inhalte nur extrahieren:

```bash
npm run ingest
```

Alternativ direkt aus Google Drive synchronisieren und dann extrahieren:

```bash
npm run sync:drive
npm run ingest:drive
```

7. Lokal durchsuchen:

```bash
npm run cli -- status
npm run cli -- magazines
npm run cli -- articles
npm run cli -- search berlin
```

8. Public-Export bauen:

```bash
npm run build:site
```

9. Lokalen HTTP-/MCP-Server starten:

```bash
npm run serve
```

10. Stdio-MCP-Server starten:

```bash
npm run mcp
```

## Public Output

Der Build unter `site/` erzeugt unter anderem:

- `index.html` und `index.md`
- `articles/<slug>/index.html` und `index.md`
- `magazines/<slug>/index.html` und `index.md`
- `api/*.json`
- `sitemap.xml`
- `robots.txt`
- `llms.txt` und `llms-full.txt`
- `/.well-known/api-catalog`
- `/.well-known/mcp/server-card.json`
- `/.well-known/agent-skills/index.json`

Der lokale HTTP-Server kann zusätzlich:

- bei `Accept: text/markdown` die Markdown-Variante einer Seite liefern
- `GET /api/search?q=berlin` als Such-API bedienen
- `POST /mcp` als Streamable-HTTP-MCP-Endpunkt bedienen
- Original-PDFs unter `/assets/pdfs/...` aus R2 oder einem anderen Object Store ausliefern
- Seitenscreenshots unter `/assets/page-images/...` aus dem generierten `site/`-Export ausliefern

## Cloudflare Deploy

Für `proud.de` ist der saubere Cloudflare-Pfad aktuell:

- statische Seiten, Markdown, JSON, `llms.txt`, Agent-Skills und Well-Known-Dateien aus `site/`
- ein kleiner Worker für die dynamischen Endpunkte `/api/search` und `/mcp`

Das bedeutet konkret:

- reines Cloudflare Pages Static Hosting reicht **nicht**, wenn `GET /api/search` und Remote-MCP live bleiben sollen
- Cloudflare Pages **mit Functions** wäre möglich
- Cloudflare Workers mit Static Assets ist für dieses Projekt der klarere Zielzustand und bereits vorbereitet

Vorbereitung:

```bash
npm run build:site
```

Dann lokal oder in CI `Wrangler` verwenden:

```bash
npx wrangler dev
npx wrangler deploy
```

Oder über die Projekt-Skripte:

```bash
npm run cf:whoami
npm run cf:dev
npm run cf:deploy
```

Die Konfiguration dafür liegt in `wrangler.jsonc`:

- `assets.directory = "./site"`
- `assets.binding = "ASSETS"`
- `assets.run_worker_first = ["/api/search", "/mcp"]`

Der Worker in `cloudflare/worker.mjs`:

- serviert alle normalen Seiten weiter aus den statischen Assets
- beantwortet `GET /api/search` aus `site/api/library.json`
- beantwortet `POST /mcp` als stateless Streamable-HTTP-MCP-Endpunkt

Wichtig: Der Worker nutzt absichtlich den bereits gebauten statischen API-Bestand unter `site/api/*.json`. Dadurch gibt es in der Cloud keine Abhängigkeit auf das lokale Dateisystem. Seitenscreenshots müssen dafür im `site/`-Export liegen. Große Original-PDFs sollten auf Cloudflare nicht als normale Assets deployt werden, weil einzelne Asset-Dateien auf `25 MiB` begrenzt sind; dafür ist R2 der richtige Speicherort.

## Screenshots und OCR

Der Ingest erzeugt jetzt pro Artikel:

- eine Preview-Grafik der ersten Seite
- Seitenscreenshots für alle Seiten des Artikels

Wichtige Umgebungsvariablen:

```bash
PROUD_ENABLE_OCR=1
PROUD_OCR_LANG=deu+eng
PROUD_OCR_PROVIDER=openrouter-page
PROUD_OCR_OPENROUTER_MODEL=google/gemini-2.5-flash
PROUD_OCR_OPENROUTER_PDF_ENGINE=mistral-ocr
PROUD_ENABLE_AI_LAYOUT=0
PROUD_ENABLE_AI_SEGMENTATION=1
PROUD_ENABLE_AI_EDITORIAL=1
PROUD_AI_REFRESH=0
PROUD_OCR_REFRESH=0
PROUD_EXPORT_PAGE_IMAGES=1
PROUD_PAGE_IMAGE_SCALE=1.0
PROUD_PAGE_IMAGE_QUALITY=70
```

Bei `PROUD_OCR_PROVIDER=openrouter-page` wird jede Seite als Einzelseiten-PDF über OpenRouter mit dem `mistral-ocr` File-Parser verarbeitet. Die Rohantworten landen unter `data/output/ocr/<pdf-slug>/pages/` und werden wiederverwendet, solange `PROUD_OCR_REFRESH=0` bleibt.

Mit `PROUD_ENABLE_AI_SEGMENTATION=1` wird aus den OCR-Seiten zusätzlich eine spread-aware Artikelsegmentierung gebaut. `PROUD_ENABLE_AI_EDITORIAL=1` aktiviert einen konservativen Cleanup-Pass für längere Artikelblöcke. `PROUD_AI_REFRESH=1` erzwingt eine Neuberechnung dieser AI-Caches.

Zusätzlich läuft lokal eine Layout-Heuristik über Tesseract-Bounding-Boxes, damit auf komplexen Spreads fehlende Karten wie Event-Listings oder Doppeltitel trotzdem als einzelne Artikel erkannt werden. `PROUD_ENABLE_AI_LAYOUT=1` schaltet darüber hinaus einen optionalen Vision-Review-Pass über OpenRouter zu. Für schnelle, reproduzierbare lokale Tests empfiehlt sich zunächst `PROUD_ENABLE_AI_LAYOUT=0`.

Hinweis: Die Seitenscreenshots erhöhen den Speicherverbrauch deutlich. Dafür bekommen wir pro Artikel eine visuelle Belegschicht, die mit dem OCR-Cache und den Artikelgrenzen verknüpft bleibt.

## Mehrsprachigkeit

Mehrsprachige Pfade werden bereits erzeugt:

- Standard: `/articles/<slug>/`
- Englisch: `/en/articles/<slug>/`

Wenn noch keine Übersetzung vorhanden ist, fällt die Seite transparent auf den Originaltext zurück und markiert den Zustand als `untranslated`.

Übersetzungs-Skelette anlegen:

```bash
npm run scaffold:translations -- en
```

Danach einzelne Dateien unter `data/input/translations/en/<slug>.json` befüllen, zum Beispiel:

```json
{
  "locale": "en",
  "slug": "cognetive-cities",
  "title": "Cognitive Cities",
  "summary": "A conversation about the future of cities and Berlin as an urban lab.",
  "excerpt": null,
  "bodyText": null,
  "markdown": null
}
```

Nach Änderungen neu bauen:

```bash
npm run build:site
```

## Manuelle Artikel-Overrides

Wenn ein Magazin nicht sauber automatisch segmentiert wird, lege eine Datei unter `data/input/manifests/<pdf-slug>.json` an:

```json
{
  "magazine": {
    "title": "proud issue 01",
    "slug": "proud-issue-01",
    "publicationDate": "2019-05-01"
  },
  "articles": [
    {
      "title": "Berlin als Zustand",
      "slug": "berlin-als-zustand",
      "authors": ["Max Beispiel"],
      "startPage": 3,
      "endPage": 7,
      "tags": ["berlin", "kultur"]
    }
  ]
}
```

Die Seitenzahlen sind `1`-basiert und inklusive.

## Google Drive

Die Drive-Anbindung läuft über `rclone`. Das OAuth-Token liegt außerhalb des Repos in deiner lokalen `rclone`-Konfiguration.

Standardmäßig erwartet das Projekt die Remote `proud-gdrive:proud`. Anpassen kannst du das in `config/site.json` oder per Umgebungsvariablen:

```bash
PROUD_DRIVE_REMOTE=my-remote \
PROUD_DRIVE_PATH="mein/pfad" \
npm run sync:drive
```
