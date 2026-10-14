# Changelog

Neueste zuerst. Jede Zeile nennt den Commit (8 Zeichen) und die Wirkung.

## 2026-10-14 — [RELEASE] v0.1.1 — hermes-agent for emino

- Stand `main` HEAD `c9d23b27`: Archiv-Engine (OCR-Ingest, Site-Build, CLI, MCP stdio, lokaler HTTP-Server, Cloudflare Worker) plus committeter Export von Ausgabe 01 (65 Artikelordner), live auf GitHub Pages.
- Seit v0.1.0 (`28b7bce1`): Git LFS für PDFs und OCR-Ausgabe, GitHub-Pages-Deploy, redaktionelles Redesign, Hero-Bilder, Credits und Impressum für Ausgabe 01, Recherche- und Presse-Doku.
- Docs: README um Status, Architektur, User flow, Komponenten, Endpunkte und Env-Namen ergänzt; CHANGELOG.md und PROMPTLOG.md neu. Kein Code geändert.

## 2026-10-06

- `c9d23b27` Merge PR #11: Design v2 auf `main`.
- `be179339` Design v2: Papier-Farbpalette, schwarze Label-Überschriften, echtes Ambigramm-Logo.
- `e955386f` Merge PR #10: Mobile-Navigation.
- `6215211d` Mobile: Sektionsnavigation bricht in zwei zentrierte Zeilen um, Datumszeilen werden nicht getrennt, Halbgeviertstrich in Seitenbereichen.
- `a4499462` Merge PR #9: Überschriftenreihenfolge.
- `8234a587` Artikelseiten: gültige Überschriften-Hierarchie (Body ab H2 unter H1, Related/Video als H2/H3).
- `aecf3dcb` Merge PR #8: redaktionelles Redesign.
- `c7f00634` Redesign der Artikelseiten im Zeitungsstil, Autorenseiten, Impressum (Masthead), About-Seite.
- `4e2c08b2` Beleg ergänzt: DFJV-Newsletter Mai 2009 erwähnt proud (aus Original-Mail verifiziert).
- `2986f963` Gedruckte Credits und Impressum für Ausgabe 01 (63 Artikel) als Daten erfasst (#7).
- `ed4374a3` Doku: Presse-Playbook und Checkliste (Presseausweis, Akkreditierung, Recht, ISSN/DNB, E-E-A-T) (#6).
- `0d96765f` Doku: Recherche zu proud, DNB-Bestand, DFJV, Bio Emin Mahrt mit Belegstufen (#5).
- `e16bd881` Typografie: Barlow für Überschriften, Inter für Fließtext, größere Schriftgrade.
- `2028f60f` Audit-Fixes P1/P2: ehrliche Discovery, 404-Bodies, `Vary`, Ausgabedaten, CLS, Kontrast, Favicon (#4).
- `5d1c6074` Beschnittene Hero-Bilder für 42 Artikel aus Ausgabe 01 veröffentlicht.
- `b568b018` `scripts/crop-heroes.py` und `heroImage`-Support im Site-Build (#3).
- `e6712f26` Artikel: größerer Text (Body 20.8-22.4px, Meta 17.6px).
- `cc6e0a79` Handoff aktualisiert: GitHub Pages ist live.
- `86790cbe` Pages: Worker-only `.well-known`-Einträge aus der Sitemap entfernt (#2).
- `7d8cfe5a` `site/` wird über GitHub Pages veröffentlicht (#1).
- `10024072` Rekonstruierte Ausgabe 15 und Cloud-Agent-Handoff hinzugefügt.
- `5c984138` Magazin-PDFs und Archiv-Ausgabe über Git LFS getrackt.

## 2026-07-03

- `f706cb10` Archiv-Rollout und lokales Deploy dokumentiert.

## 2026-06-30

- `9259f688` Lese-Layout der Artikel verfeinert.
- `28b7bce1` Quell-PDFs aus Git herausgehalten (`.gitignore`). Tag `v0.1.0` zeigt auf diesen Commit.
- `9cf8e119` Erster Commit: agent-ready proud-Archiv veröffentlicht.

Ältere Release Notes: [RELEASE_NOTES.md](RELEASE_NOTES.md).
