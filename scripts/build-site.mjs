import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { ensureWorkspace } from "../src/lib/config.mjs";
import { renderInlineMarkdown, renderMarkdownToHtml, escapeHtml } from "../src/lib/html.mjs";
import { detectLanguageFromText, localizeArticle, localeLabel } from "../src/lib/i18n.mjs";
import { loadLibrary, sortArticles } from "../src/lib/store.mjs";
import { PROJECT_ROOT } from "../src/lib/config.mjs";
import {
  DNB_URL, ISSUU_URL, ZDB_ID, DNB_SHELF, STATIC_PAGES,
  CURRENT_PUBLISHER, loadEditorialData, buildPeople, bylineFor, personRoleLabels, legalIsComplete,
  staticPageTitle, staticPageDescription, staticPageMarkdown, staticPageMarkdownWithMarker, dfjvMentionHtml, canonicalPersonName, slugifyName,
} from "./lib/editorial.mjs";

const execFileAsync = promisify(execFile);
const IMAGE_EXTENSION_RE = /\.(png|jpe?g)$/i;

const CSS = `@font-face { font-family: "Barlow"; font-weight: 600; font-style: normal; font-display: swap; src: url("/assets/fonts/barlow-latin-600-normal.woff2") format("woff2"); }
@font-face { font-family: "Barlow"; font-weight: 700; font-style: normal; font-display: swap; src: url("/assets/fonts/barlow-latin-700-normal.woff2") format("woff2"); }
@font-face { font-family: "Inter"; font-weight: 100 900; font-style: normal; font-display: swap; src: url("/assets/fonts/inter-latin-wght-normal.woff2") format("woff2"); }
:root {
  color-scheme: light;
  --bg: #ffffff;
  --paper: #ffffff;
  --paper-soft: #f7f7f4;
  --ink: #181411;
  --muted: #6f6a61;
  --line: #e4e0d8;
  --accent: var(--ink);
  --proud-pink: #d0005f;
  --accent-soft: #f1f0ed;
  --shadow: none;
  --ui-font: "Barlow", "DIN Alternate", "Bahnschrift", "Helvetica Neue", Arial, sans-serif;
  --serif-font: "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
  --display-font: "Barlow", "DIN Alternate", "Bahnschrift", "Helvetica Neue", Arial, sans-serif;
  --size-logo: clamp(1.8rem, 3vw, 2.45rem);
  --size-title: clamp(2.5rem, 6vw, 4.2rem);
  --size-subhead: clamp(1.6rem, 2.6vw, 2.1rem);
  --size-body: clamp(1.35rem, 1.9vw, 1.5rem);
  --size-meta: 1.1rem;
}

* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body {
  margin: 0;
  font-family: var(--serif-font);
  background: var(--bg);
  color: var(--ink);
  overflow-x: hidden;
}
a {
  color: inherit;
  text-decoration-color: rgba(127, 35, 31, 0.35);
  text-underline-offset: 0.14em;
}
a:hover { text-decoration-color: rgba(127, 35, 31, 0.8); }
img { max-width: 100%; height: auto; display: block; }
main {
  width: min(1080px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: 0.6rem 0 4.5rem;
}
.masthead-top {
  display: none;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 0.6rem 0 0.75rem;
  border-bottom: 1px solid var(--line);
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--muted);
}
.masthead-date {
  text-align: center;
}
body.article-page main {
  width: min(1120px, calc(100vw - 2rem));
  padding-top: 0;
}
header.site-header {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 0;
  border-bottom: 1px solid var(--line);
}
body.article-page header.site-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 0;
  border-bottom: 1px solid var(--line);
}
.brand h1,
body.article-page .brand h1 {
  font-family: var(--display-font);
  font-size: var(--size-logo);
  letter-spacing: -0.05em;
}
.brand p,
body.article-page .brand p {
  display: none;
}
.brand { max-width: 40rem; }
.brand h1,
.brand p { margin: 0; }
.brand h1 { font-weight: 700; line-height: 0.92; }
.brand p {
  color: var(--muted);
  margin-top: 0.55rem;
  line-height: 1.5;
  font-size: var(--size-body);
  max-width: 34rem;
}
nav.topnav,
.locale-nav,
.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
}
nav.topnav a,
.locale-nav a,
.locale-chip,
.button-link {
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  text-decoration: none;
}
nav.topnav a {
  color: var(--ink);
  padding: 0.35rem 0;
  font-size: var(--size-meta);
  text-transform: uppercase;
  letter-spacing: 0.11em;
}
nav.topnav a:hover { color: var(--ink); }
.hero,
.panel,
.issue-card,
.article-card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: var(--shadow);
}
.hero {
  padding: clamp(1rem, 1.5vw, 1.4rem) 0;
  border: 0;
  border-bottom: 1px solid var(--line);
}
body.article-page .hero {
  padding: clamp(1.1rem, 2.6vw, 2rem) 0 0.7rem;
  border-bottom: 0;
}
body.article-page .article-hero-inner {
  max-width: 760px;
  margin: 0 auto;
}
.hero-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: 1fr;
  align-items: start;
}
.hero-copy {
  min-width: 0;
  max-width: 100%;
}
.hero-preview {
  display: grid;
  gap: 0.55rem;
  align-self: stretch;
  margin: 0;
}
.hero-preview-grid {
  display: grid;
  gap: 0.65rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
.hero-preview-card {
  position: relative;
  overflow: hidden;
  border-radius: 16px;
  border: 1px solid var(--line);
  background: var(--paper-soft);
}
.hero-preview-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  aspect-ratio: 4 / 5;
}
.hero-preview-badge {
  position: absolute;
  left: 0.7rem;
  bottom: 0.7rem;
  padding: 0.35rem 0.55rem;
  border-radius: 999px;
  background: rgba(31, 28, 25, 0.86);
  color: #fff;
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  line-height: 1;
}
.hero-preview figcaption {
  font-family: var(--ui-font);
  color: var(--muted);
  font-size: var(--size-meta);
}
.panel {
  padding: clamp(1rem, 1.5vw, 1.35rem);
}
.panel-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
}
.hero h2,
.panel > h2,
.panel > h3 {
  margin: 0;
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-transform: none;
  color: var(--accent);
}
.hero h2 {
  display: inline-block;
  width: fit-content;
  max-width: 100%;
  margin-top: 0.3rem;
  font-family: var(--display-font);
  font-size: var(--size-title);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.18;
  overflow-wrap: anywhere;
}
body.article-page .hero h2 {
  max-width: 18ch;
  margin-top: 0.35rem;
  font-family: var(--ui-font);
  font-size: var(--size-title);
  font-weight: 800;
  letter-spacing: -0.025em;
  line-height: 1.18;
}
.lede {
  margin: 0.75rem 0 0;
  max-width: min(43rem, 100%);
  color: var(--ink);
  font-size: var(--size-body);
  line-height: 1.68;
  overflow-wrap: break-word;
}
body.article-page .lede {
  max-width: 720px;
  margin-top: 0.7rem;
  color: var(--ink);
  font-size: var(--size-body);
  line-height: 1.45;
}
.hero h2,
.panel > h2,
.panel > h3,
.lead-story h2 a,
.article-card h3 a,
.story-teaser h3 a,
.related-story h4 a,
.content h1,
.content h2,
.content h3 {
  display: inline-block;
  width: fit-content;
  max-width: 100%;
  background: var(--ink);
  color: #fff;
  padding: 0.08em 0.28em 0.12em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  text-decoration: none;
}
.meta {
  color: var(--muted);
  font-size: var(--size-meta);
  line-height: 1.6;
  font-family: var(--ui-font);
}
.stat-row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.8rem;
}
.stat-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.55rem 0.82rem;
  border-radius: 999px;
  background: rgba(255,255,255,0.55);
  border: 1px solid var(--line);
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stat-chip strong {
  color: var(--ink);
  font-weight: 700;
}
.button-link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.35rem;
  min-height: 2.6rem;
  padding: 0.72rem 0.95rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: transparent;
  color: var(--ink);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: var(--size-meta);
}
.button-link.primary {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
.button-link.subtle {
  background: rgba(255,255,255,0.55);
}
.button-link:hover {
  border-color: rgba(127, 35, 31, 0.35);
}
.locale-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.3rem;
  min-height: 2.75rem;
  padding: 0.55rem 0.82rem;
  border-radius: 999px;
  border: 1px solid var(--line);
  background: var(--paper-soft);
  color: var(--muted);
}
.locale-chip.current {
  background: var(--ink);
  border-color: var(--ink);
  color: #fff;
}
.locale-chip.missing {
  background: #fff7e7;
  border-color: #edd29d;
  color: #8b6b2c;
}
.article-shell {
  display: block;
  margin-top: 1.6rem;
}
.article-shell.no-support {
  display: block;
}
.article-main {
  min-width: 0;
}
body.article-page .article-main > .panel {
  max-width: 760px;
  margin: 0 auto;
  padding: 0;
  border: 0;
  background: transparent;
}
.article-rail {
  margin: 3rem auto 0;
  max-width: 760px;
  display: grid;
  gap: 1.4rem;
}
.article-rail .panel {
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  padding: 1.2rem 0 0;
}
.article-rail .panel h3,
.story-section h3 {
  margin-bottom: 0.9rem;
  font-size: var(--size-body);
  font-family: var(--ui-font);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.2;
  text-transform: none;
  background: transparent;
  color: var(--ink);
  display: inline-block;
  padding: 0;
}
.article-top-scans {
  width: min(100%, 920px);
  margin: 1rem auto 2rem;
}
.article-top-scans .page-gallery {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 460px));
  gap: 0;
  justify-content: center;
  align-items: start;
}
.article-top-scans.single {
  max-width: 520px;
}
.article-top-scans.single .page-gallery {
  grid-template-columns: 1fr;
}
.article-top-scans .page-card {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}
.article-top-scans .page-card img {
  width: 100%;
  border-radius: 0;
}
.article-top-scans .page-card:first-child img {
  border-radius: 14px 0 0 14px;
}
.article-top-scans .page-card:last-child img {
  border-radius: 0 14px 14px 0;
}
.article-top-scans.single .page-card img {
  border-radius: 14px;
}
.article-top-scans .page-card figcaption {
  margin-top: 0.45rem;
}
.article-meta-list {
  display: grid;
  gap: 0.55rem;
}
.article-meta-item {
  display: grid;
  grid-template-columns: 7rem minmax(0, 1fr);
  gap: 1rem;
  align-items: baseline;
}
.article-meta-item small {
  display: block;
  font-family: var(--ui-font);
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: var(--size-meta);
  margin-bottom: 0.22rem;
}
.article-meta-item div {
  font-family: var(--ui-font);
  line-height: 1.45;
  color: var(--muted);
}
.content {
  margin: 0 auto;
  line-height: 1.6;
  font-size: var(--size-body);
  max-width: 760px;
}
.content > *:first-child { margin-top: 0; }
.content > p:first-of-type::first-letter {
  float: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  padding: 0;
}
body:not(.article-page) .content > p:first-of-type::first-letter {
  float: none;
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  padding: 0;
}
.content h1,
.content h2,
.content h3 {
  font-family: var(--ui-font);
  font-size: var(--size-subhead);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.28;
  margin: 2.6rem 0 0.9rem;
}
.proud-word {
  color: var(--proud-pink);
}
.content p,
.content ul,
.content ol {
  margin: 1.15rem 0;
}
.content blockquote {
  margin: 2rem 0;
  padding: 0 0 0 1rem;
  border-left: 3px solid var(--line);
  color: var(--muted);
  font-style: italic;
}
.content code {
  background: #f1ede6;
  padding: 0.12rem 0.35rem;
  border-radius: 0.3rem;
  font-size: inherit;
}
.translation-note {
  margin-top: 1rem;
  padding: 0.95rem 1rem;
  background: #fbf1dd;
  border: 1px solid #d7b77f;
  border-radius: 12px;
  font-family: var(--ui-font);
}
.tldr-box {
  margin-top: 1.4rem;
  padding: 1rem 0 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  background: transparent;
}
.tldr-box strong {
  display: block;
  margin-bottom: 0.4rem;
  font-family: var(--ui-font);
  letter-spacing: -0.02em;
}
.tldr-box p {
  margin: 0;
}
.content-sequence {
  display: grid;
  gap: 1rem;
}
.content-sequence-intro {
  margin-bottom: 1rem;
}
.page-block {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(230px, 330px) minmax(0, 1fr);
  align-items: start;
  padding: 1rem;
  border: 1px solid var(--line);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(251, 250, 247, 0.85), rgba(255, 255, 255, 0.98));
}
.page-block-media {
  display: grid;
  gap: 0.5rem;
}
.page-block-media img,
.hero-preview img,
.page-card img,
.issue-card img,
.article-card img {
  border-radius: 16px;
  border: 1px solid var(--line);
}
.page-gallery {
  display: grid;
  gap: 0.9rem;
  grid-template-columns: 1fr;
}
.page-card {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 0.7rem;
}
.section-stack {
  display: grid;
  gap: 1.2rem;
  margin-top: 1.4rem;
}
.section-rule {
  display: none;
}
.ranking-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.8rem;
}
.ranking-list li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: flex-start;
  padding-top: 0.8rem;
  border-top: 1px solid var(--line);
}
.ranking-list li:first-child {
  border-top: 0;
  padding-top: 0;
}
.ranking-list strong {
  display: block;
  font-family: var(--ui-font);
}
.issue-grid,
.article-list,
.magazine-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 1rem;
}
.issue-card,
.article-card {
  padding: 1rem 1rem 1.05rem;
}
.issue-grid .issue-card {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  align-items: center;
  padding: 1rem 0;
  border: 0;
  border-radius: 0;
  background: transparent;
}
.issue-grid .issue-card + .issue-card {
  border-top: 1px solid var(--line);
}
.issue-grid .review-actions {
  margin-top: 0;
}
.article-card {
  display: grid;
  gap: 1rem;
}
.article-card.with-media {
  grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
}
.article-list {
  gap: 0;
}
.article-list .article-card {
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: clamp(1.45rem, 2.2vw, 2rem) 0;
}
.article-list .article-card:first-child {
  border-top: 0;
}
.article-list .article-card.with-media {
  grid-template-columns: minmax(0, 1fr) clamp(130px, 22vw, 220px);
  gap: clamp(1.1rem, 3vw, 2rem);
  align-items: start;
}
.article-list .article-card-media {
  order: 2;
}
.article-list .article-card-body {
  order: 1;
}
.article-list .article-card-media .meta,
.article-list .stat-row,
.article-list .topic-row,
.article-list .review-actions {
  display: none;
}
.article-list .article-card-media img {
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: 4px;
}
.article-list .article-card h3 {
  font-family: var(--ui-font);
  font-size: var(--size-subhead);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.28;
  text-decoration: none;
}
.article-list .article-card h3 a {
  text-decoration: none;
}
.article-list .article-card-body > p:first-of-type {
  color: var(--ink);
  font-family: var(--serif-font);
  font-size: var(--size-body);
  line-height: 1.45;
  margin-top: 0.6rem;
  -webkit-line-clamp: 5;
}
.list-panel {
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  border-radius: 0;
  box-shadow: none;
  padding: clamp(1rem, 2vw, 1.5rem) 0 0;
}
.list-panel > h3 {
  font-family: var(--ui-font);
  font-size: var(--size-body);
  letter-spacing: -0.02em;
  text-transform: none;
  background: transparent;
  color: var(--ink);
  display: inline-block;
  padding: 0;
}
.article-card-media {
  display: grid;
  gap: 0.5rem;
}
.article-card-media figure {
  margin: 0;
}
.article-card-media img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
}
.article-card-body {
  min-width: 0;
}
.issue-card-header,
.article-card-header {
  display: flex;
  gap: 1rem;
  justify-content: space-between;
  align-items: flex-start;
}
.issue-card h3,
.article-card h3,
.article-card h4 {
  margin: 0;
  font-family: var(--ui-font);
  font-size: var(--size-subhead);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.28;
}
.issue-card p,
.article-card p {
  margin: 0.6rem 0 0;
}
.article-card .meta,
.issue-card .meta {
  margin-top: 0.55rem;
}
.review-actions {
  margin-top: 0.9rem;
}
.review-actions .button-link {
  font-size: var(--size-meta);
  min-height: 2.25rem;
  padding: 0.58rem 0.82rem;
}
.inline-note {
  margin-top: 0.9rem;
  padding: 0.85rem 0.95rem;
  border-radius: 12px;
  border: 1px solid var(--line);
  background: var(--paper-soft);
  color: var(--muted);
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  line-height: 1.55;
}
.support-panel h3 { margin-bottom: 0.85rem; }
.story-byline {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1rem;
  font-family: var(--serif-font);
  font-size: var(--size-body);
  line-height: 1.45;
  color: var(--muted);
  text-transform: none;
  letter-spacing: 0;
}
body.article-page .story-byline {
  margin-top: 0.65rem;
  padding-bottom: 0.65rem;
  border-bottom: 1px solid var(--line);
}
.language-switch {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.7rem;
  margin-top: 1.15rem;
}
.compact-locale-nav {
  margin-top: 0.8rem;
}
body.article-page .language-switch {
  margin-top: 0.75rem;
}
.language-switch-label {
  font-family: var(--ui-font);
  color: var(--muted);
  font-size: var(--size-meta);
  text-transform: none;
  letter-spacing: 0;
}
.lead-story-copy .topic-row,
.article-card-body .topic-row,
.story-teaser .topic-row {
  margin-top: 0.75rem;
}
.hero-visual {
  display: grid;
  gap: 0.75rem;
}
.hero-caption {
  margin: 0;
  color: var(--muted);
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  line-height: 1.5;
}
.topic-row {
  display: none;
  flex-wrap: wrap;
  gap: 0.45rem;
  margin-top: 0.9rem;
}
.topic-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.32rem 0.6rem;
  border-radius: 999px;
  border: 1px solid rgba(127, 35, 31, 0.18);
  background: var(--accent-soft);
  color: var(--accent);
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}
.pull-quote {
  margin: 0 0 2rem;
  padding: 0 0 0 1rem;
  border-left: 3px solid var(--line);
  background: transparent;
  font-family: var(--display-font);
  font-size: var(--size-body);
  line-height: 1.35;
  color: var(--muted);
}
.story-section {
  background: transparent;
  border: 0;
  border-top: 1px solid var(--line);
  border-radius: 0;
  padding: 1.2rem 0 0;
}
body.article-page .story-section {
  max-width: 760px;
  margin: 3rem auto 0;
  background: transparent;
}
.section-stack > .panel {
  border-radius: 0;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  padding: 1.5rem 0 0;
}
.section-stack > .panel > .section-rule {
  display: none;
}
.article-secondary-grid {
  display: grid;
  gap: 1rem;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  margin-top: 1rem;
}
.story-section h3 {
  margin: 0 0 0.9rem;
  font-size: var(--size-body);
}
.link-list {
  list-style: none;
  padding: 0;
  margin: 0;
  display: grid;
  gap: 0.9rem;
}
.link-list li {
  padding-top: 0.8rem;
  border-top: 1px solid rgba(24, 20, 17, 0.1);
}
.link-list li:first-child {
  border-top: 0;
  padding-top: 0;
}
.point-list {
  list-style: disc;
  padding-left: 1rem;
}
.point-list li {
  border-top: 0;
  padding-top: 0;
}
.video-grid,
.story-related-grid,
.story-teaser-grid {
  display: grid;
  gap: 1rem;
}
.story-related-grid {
  gap: 0;
}
.video-card,
.related-story,
.story-teaser {
  background: transparent;
  border: 0;
  border-radius: 0;
  padding: 0;
}
.video-frame {
  position: relative;
  width: 100%;
  padding-top: 56.25%;
  overflow: hidden;
  border-radius: 10px;
  background: #000;
  margin-bottom: 0.8rem;
}
.video-frame iframe {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  border: 0;
}
.video-card-body h4,
.related-story h4,
.story-teaser h3 {
  margin: 0;
  font-family: var(--ui-font);
  font-size: var(--size-subhead);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.28;
}
.related-story {
  padding: 1rem 0;
  border-top: 1px solid var(--line);
}
.related-story:first-child {
  border-top: 0;
  padding-top: 0;
}
.related-story p {
  margin: 0.45rem 0 0;
  color: var(--ink);
  font-family: var(--serif-font);
  font-size: var(--size-body);
  line-height: 1.45;
}
.front-page-grid {
  display: grid;
  gap: 0;
  grid-template-columns: 1fr;
  align-items: start;
  margin-top: 1.5rem;
}
.lead-story {
  display: grid;
  gap: clamp(1.4rem, 3vw, 2.4rem);
  grid-template-columns: minmax(0, 1fr) minmax(280px, 0.72fr);
  align-items: start;
}
.lead-story h2 {
  margin: 0.35rem 0 0;
  font-family: var(--ui-font);
  font-size: var(--size-title);
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.18;
}
.lead-story .deck {
  margin: 1rem 0 0;
  max-width: 36rem;
  font-size: var(--size-body);
  line-height: 1.45;
}
.lead-story-art,
.story-teaser-art {
  margin: 0;
}
.article-hero-art {
  margin: 1.2rem 0 0;
}
.article-hero-art img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--line);
}
.article-hero-art figcaption {
  margin-top: 0.4rem;
}
.lead-story-art img,
.story-teaser-art img {
  width: 100%;
  aspect-ratio: 3 / 2;
  object-fit: cover;
  border-radius: 10px;
  border: 1px solid var(--line);
}
.story-teaser-grid {
  grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
  gap: clamp(1.5rem, 3vw, 2.4rem);
}
.story-teaser {
  display: grid;
  align-content: start;
  row-gap: 1.15rem;
}
.story-teaser p:not(.meta),
.article-card-body > p:first-of-type,
.related-story p {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  overflow: hidden;
}
.story-teaser p:not(.meta) {
  margin-top: 0.85rem;
  font-size: var(--size-body);
  line-height: 1.45;
}
.front-page-rail h3 {
  font-family: var(--display-font);
  font-size: var(--size-body);
  margin-top: 0.3rem;
}
.front-page-rail .lede {
  font-size: var(--size-body);
  line-height: 1.55;
}
.front-page-rail.panel {
  border-radius: 0;
  border-right: 0;
  border-bottom: 0;
  border-left: 0;
  padding: 1.2rem 0 0;
}
.front-page-rail .stat-row,
.front-page-rail .action-row,
.front-page-rail .locale-nav {
  display: none;
}
.meta-link-list {
  display: grid;
  gap: 0.55rem;
}
.meta-link-list a {
  font-family: var(--ui-font);
}
.tldr {
  margin: 1rem 0 0;
  padding: 0.9rem 1rem;
  border-left: 4px solid var(--proud-pink);
  background: var(--paper-soft);
}
.tldr-label {
  display: block;
  font-family: var(--ui-font);
  font-size: var(--size-meta);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--muted);
}
.tldr .lede { margin-top: 0.35rem; }
.visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
footer {
  border-top: 1px solid var(--line);
  margin-top: 3rem;
  padding-top: 1.1rem;
  color: var(--muted);
  font-family: var(--serif-font);
  font-size: var(--size-body);
  line-height: 1.45;
}
@media (max-width: 980px) {
  .article-rail { position: static; }
  .hero-grid { grid-template-columns: 1fr; }
  .front-page-grid,
  .lead-story { grid-template-columns: 1fr; }
}
@media (max-width: 760px) {
  html,
  body {
    max-width: 100vw;
    overflow-x: hidden;
  }
  body.article-page main {
    width: min(100vw - 2rem, 760px);
  }
  main,
  .hero,
  .hero-copy,
  .section-stack,
  .panel,
  .article-list,
  .article-card,
  .article-card-body {
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }
  p,
  .lede,
  .article-card-body {
    overflow-wrap: anywhere;
  }
  header.site-header {
    align-items: center;
    gap: 0.75rem;
  }
  nav.topnav {
    display: flex;
    gap: 1rem;
  }
  nav.topnav a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
    padding: 0;
  }
  .brand h1 a,
  .lead-story h2 a,
  .article-card h3 a,
  .story-teaser h3 a,
  .related-story h4 a,
  .issue-card h3 a {
    display: inline-flex;
    align-items: center;
    min-height: 44px;
  }
  body.article-page header.site-header {
    align-items: center;
    gap: 1rem;
  }
  .brand h1,
  body.article-page .brand h1 {
    font-size: var(--size-logo);
  }
  .hero h2 { max-width: 100%; }
  .hero .lede {
    font-size: var(--size-body);
    line-height: 1.5;
    max-width: 100%;
  }
  body.article-page .hero {
    padding-top: 1.4rem;
  }
  body.article-page .story-byline,
  body.article-page .language-switch,
  body.article-page .action-row {
    align-items: flex-start;
    flex-direction: column;
  }
  .article-top-scans,
  .article-top-scans.single {
    max-width: 100%;
    margin: 1.2rem auto 2rem;
  }
  .article-top-scans .page-gallery {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0;
  }
  .article-list .article-card.with-media {
    grid-template-columns: 1fr;
  }
  .article-list .article-card-media {
    display: none;
  }
  main { width: min(100vw - 2rem, 1220px); }
  .page-block { grid-template-columns: 1fr; }
}`;

// Editorial layer (NYT-style masthead, bylines, author pages, static pages). Bright paper, hairline rules,
// pink only for the wordmark, kickers and focus. No animation. Minimum text 17px (1.0625rem at 16px root).
const EDITORIAL_CSS_SOURCE = `
.masthead-strip {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0 1rem;
  padding: 0; border-bottom: 1px solid var(--line);
  font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); letter-spacing: 0.02em;
}
.masthead-strip a { color: var(--muted); text-decoration: none; display: inline-flex; align-items: center; min-height: 44px; }
.masthead-strip a:hover { color: var(--ink); text-decoration: underline; }
header.site-header.masthead {
  display: grid; grid-template-columns: 1fr; justify-items: center; gap: 0.2rem;
  padding: 0.9rem 0 0; border-bottom: 3px double var(--ink);
}
body.article-page header.site-header.masthead { display: grid; padding: 0.9rem 0 0; border-bottom: 3px double var(--ink); }
.wordmark {
  margin: 0; font-family: var(--display-font); font-weight: 700; line-height: 1;
  font-size: clamp(2.8rem, 8vw, 4.6rem); letter-spacing: -0.05em; color: var(--proud-pink);
}
.wordmark a { color: var(--proud-pink); text-decoration: none; display: inline-flex; min-height: 44px; align-items: center; }
.wordmark-sub { margin: 0; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); letter-spacing: 0.14em; text-transform: uppercase; }
nav.sections {
  display: flex; flex-wrap: wrap; justify-content: center; gap: 0 1.4rem; width: 100%;
  margin-top: 0.5rem; border-top: 1px solid var(--line);
}
nav.sections a {
  display: inline-flex; align-items: center; min-height: 48px; padding: 0 0.1rem;
  font-family: var(--ui-font); font-size: var(--size-meta); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
  color: var(--ink); text-decoration: none;
}
nav.sections a:hover, nav.sections a[aria-current="page"] { box-shadow: inset 0 -3px 0 var(--proud-pink); }
nav.sections .lang-link { color: var(--muted); }
a:focus-visible { outline: 3px solid var(--proud-pink); outline-offset: 2px; }
.kicker {
  display: flex; flex-wrap: wrap; align-items: center; gap: 0.45rem 0.7rem; margin: 0 0 0.25rem;
  font-family: var(--ui-font); font-size: var(--size-meta); font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--muted);
}
.kicker .kicker-tag { background: var(--ink); color: #fff; padding: 0.1em 0.45em; letter-spacing: 0.04em; }
.kicker-rubric { color: var(--proud-pink); }
.kicker .proud-word, .news-headline .proud-word, .byline .proud-word { color: inherit; }
body .news-headline,
.content h1, .content h2, .content h3 {
  display: block; width: auto; background: transparent; color: var(--ink); padding: 0;
}
.news-headline {
  margin: 0.7rem 0 0; text-wrap: balance; font-family: var(--display-font); font-weight: 700; font-size: var(--size-title);
  line-height: 1.08; letter-spacing: -0.02em; overflow-wrap: break-word; hyphens: auto;
}
.news-headline a { color: inherit; text-decoration: none; }
.news-headline a:hover { text-decoration: underline; text-decoration-thickness: 2px; }
.deck { text-wrap: pretty; margin: 0.8rem 0 0; font-family: var(--serif-font); font-size: var(--size-body); line-height: 1.45; color: #3a352f; max-width: 42rem; }
.byline-block { margin-top: 1.1rem; padding-top: 0.9rem; border-top: 1px solid var(--line); display: grid; gap: 0.35rem; }
.byline { margin: 0; font-family: var(--ui-font); font-size: var(--size-meta); font-weight: 600; color: var(--ink); letter-spacing: 0.01em; }
.byline a { color: var(--ink); text-decoration: underline; text-decoration-color: var(--line); text-underline-offset: 0.2em; }
.byline-credits, .dateline { margin: 0; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); line-height: 1.5; }
.byline-credits a { color: var(--muted); }
.action-bar { display: flex; flex-wrap: wrap; gap: 0.5rem 0.6rem; margin-top: 0.9rem; }
.action-bar a {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 0.9rem; border: 1px solid var(--line); border-radius: 2px;
  font-family: var(--ui-font); font-size: var(--size-meta); font-weight: 600; color: var(--ink); text-decoration: none; background: #fff;
}
.action-bar a:hover { border-color: var(--ink); }
.action-bar a[aria-current="page"] { background: var(--ink); color: #fff; border-color: var(--ink); }
.author-note {
  display: grid; gap: 0.2rem; margin-top: 0.9rem; padding: 0.1rem 0 0.1rem 0.9rem; border-left: 2px solid var(--line);
  font-family: var(--ui-font); font-size: var(--size-meta); line-height: 1.5; color: var(--muted);
}
.author-note strong { color: var(--ink); }
.author-note a, .byline a, .byline-credits a, .author-box-entry a { text-decoration: underline; text-decoration-thickness: 1px; text-decoration-color: rgba(24, 20, 17, 0.35); text-underline-offset: 0.2em; }
.author-note p { margin: 0; }
.article-figure { margin: 1.4rem 0 0; }
.article-figure img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; border-radius: 0; border: 0; background: var(--paper-soft); }
.article-figure figcaption { display: flex; flex-wrap: wrap; gap: 0.2rem 0.6rem; justify-content: space-between; margin-top: 0.45rem; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); line-height: 1.45; }
.photo-credit { text-transform: uppercase; letter-spacing: 0.05em; }
body.article-page .content h2, body.article-page .content h3 {
  font-family: var(--ui-font); font-weight: 800; font-size: var(--size-subhead); line-height: 1.25; letter-spacing: -0.015em;
  margin: 2.4rem 0 0.7rem;
}
body.article-page .content h1 { font-size: var(--size-subhead); font-weight: 800; }
.author-box {
  max-width: 760px; margin: 3rem auto 0; padding: 1.2rem 0; border-top: 2px solid var(--ink); border-bottom: 1px solid var(--line);
  display: grid; gap: 1.1rem;
}
.author-box h2, .section-label {
  margin: 0; font-family: var(--ui-font); font-size: var(--size-meta); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--ink);
  background: transparent; padding: 0; display: block;
}
.author-box-entry h3 { margin: 0; font-family: var(--display-font); font-size: var(--size-subhead); font-weight: 700; line-height: 1.2; background: transparent; color: var(--ink); padding: 0; display: block; }
.author-box-entry h3 a { color: inherit; text-decoration: none; display: inline-flex; min-height: 44px; align-items: center; }
.author-box-entry p { margin: 0.25rem 0 0; font-size: var(--size-body); line-height: 1.5; }
.author-box-entry .meta { font-size: var(--size-meta); }
.home-lead { display: grid; gap: clamp(1.2rem, 3vw, 2.4rem); grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); align-items: start; padding: 1.6rem 0 1.8rem; border-bottom: 1px solid var(--ink); }
.home-lead figure { margin: 0; }
.home-lead img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; }
.home-lead figcaption { margin-top: 0.4rem; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); }
.story-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; padding: 0; margin: 0; list-style: none; }
.story-grid > li { padding: 1.4rem 1.2rem 1.6rem; border-bottom: 1px solid var(--line); border-left: 1px solid var(--line); min-width: 0; }
.story-grid > li:nth-child(3n+1) { border-left: 0; padding-left: 0; }
.story-grid > li:nth-child(3n) { padding-right: 0; }
.story-grid img { width: 100%; aspect-ratio: 3 / 2; object-fit: cover; margin-bottom: 0.8rem; }
.story-grid .news-headline { font-size: var(--size-subhead); line-height: 1.18; }
.story-grid .dateline { margin-top: 0.7rem; }
.story-grid .deck { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4; overflow: hidden; }
.section-head { display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; margin: 2.4rem 0 0; padding-top: 0.6rem; border-top: 2px solid var(--ink); }
.section-head a { font-family: var(--ui-font); font-size: var(--size-meta); color: var(--ink); display: inline-flex; min-height: 44px; align-items: center; }
.issue-strip { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1.2rem; list-style: none; padding: 0; margin: 1rem 0 0; }
.issue-strip a { display: block; text-decoration: none; color: var(--ink); }
.issue-strip img { width: 100%; aspect-ratio: 3 / 4; object-fit: cover; border: 1px solid var(--line); }
.issue-strip strong { display: block; margin-top: 0.5rem; font-family: var(--display-font); font-size: var(--size-subhead); }
.issue-strip span { font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); }
.page-head { padding: 1.8rem 0 1.2rem; border-bottom: 1px solid var(--line); }
.prose { max-width: 760px; margin: 1.6rem 0 0; font-size: var(--size-body); line-height: 1.6; }
.prose h2 { font-family: var(--ui-font); font-size: var(--size-subhead); font-weight: 800; line-height: 1.25; margin: 2.2rem 0 0.6rem; background: transparent; color: var(--ink); padding: 0; display: block; }
.prose ul { padding-left: 1.2rem; }
.prose blockquote { margin: 0.8rem 0 0.4rem; padding: 0 0 0 1rem; border-left: 3px solid var(--proud-pink); font-style: normal; }
.prose blockquote + .meta { margin-top: 0; }
.press-quote { margin: 1rem 0 0; }
.press-quote blockquote { margin: 0; padding: 0 0 0 1rem; border-left: 3px solid var(--proud-pink); }
.press-quote blockquote p { margin: 0; }
.press-quote figcaption { margin-top: 0.4rem; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); }
.prose li { margin: 0.35rem 0; }
.people-list { list-style: none; padding: 0; margin: 1.4rem 0 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 0 1.6rem; }
.people-list li { padding: 0.9rem 0; border-top: 1px solid var(--line); }
.people-list a { font-family: var(--display-font); font-size: var(--size-subhead); font-weight: 700; color: var(--ink); text-decoration: none; display: inline-flex; min-height: 44px; align-items: center; }
.people-list span { display: block; font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); }
.plain-list { list-style: none; padding: 0; margin: 0.6rem 0 0; }
.plain-list li { padding: 0.75rem 0; border-top: 1px solid var(--line); }
.plain-list a { font-family: var(--ui-font); font-weight: 700; font-size: var(--size-body); color: var(--ink); }
.plain-list .meta { display: block; }
footer.site-footer {
  margin-top: 4rem; padding: 1.6rem 0 2rem; border-top: 3px double var(--ink);
  font-family: var(--ui-font); font-size: var(--size-meta); color: var(--muted); line-height: 1.5;
}
.footer-brand { margin: 0 0 1rem; font-family: var(--display-font); font-weight: 700; font-size: 2.2rem; letter-spacing: -0.05em; color: var(--proud-pink); }
.footer-columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 0.2rem 1.4rem; list-style: none; padding: 0; margin: 0; }
.footer-columns a { display: inline-flex; align-items: center; min-height: 44px; color: var(--ink); text-decoration: none; font-weight: 600; }
.footer-columns a:hover { text-decoration: underline; }
.trust-line { margin: 1.2rem 0 0; padding-top: 1rem; border-top: 1px solid var(--line); }
.trust-line a { color: var(--ink); }
@media (max-width: 980px) {
  .home-lead { grid-template-columns: 1fr; }
  .home-lead figure { order: -1; }
  .story-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .story-grid > li, .story-grid > li:nth-child(3n+1), .story-grid > li:nth-child(3n) { padding: 1.3rem 1rem 1.5rem; border-left: 1px solid var(--line); }
  .story-grid > li:nth-child(2n+1) { border-left: 0; padding-left: 0; }
  .story-grid > li:nth-child(2n) { padding-right: 0; }
}
@media (max-width: 640px) {
  .story-grid { grid-template-columns: 1fr; }
  .story-grid > li, .story-grid > li:nth-child(n) { padding: 1.2rem 0; border-left: 0; }
  nav.sections { flex-wrap: nowrap; justify-content: flex-start; gap: 0 1.1rem; overflow-x: auto; scrollbar-width: none; -webkit-overflow-scrolling: touch; }
  nav.sections::-webkit-scrollbar { display: none; }
  nav.sections a { flex: 0 0 auto; }
  .masthead-strip { justify-content: center; text-align: center; }
  body.article-page .action-row { flex-direction: row; }
  .footer-columns { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
`;

const AI_CRAWLER_RULES = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "ClaudeBot",
  "Claude-SearchBot",
  "Google-Extended",
  "meta-externalagent",
  "PerplexityBot",
  "CCBot",
  "Bytespider",
  "cohere-ai",
  "Amazonbot",
  "Applebot-Extended",
];

const MCP_TOOLS = [
  {
    name: "list_magazines",
    description: "List available proud magazine issues.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "list_articles",
    description: "List archive articles, optionally filtered by magazine slug.",
    inputSchema: {
      type: "object",
      properties: {
        magazineSlug: { type: "string" },
        limit: { type: "integer" },
      },
    },
  },
  {
    name: "search_articles",
    description: "Search article full text and metadata.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string" },
        limit: { type: "integer" },
      },
      required: ["query"],
    },
  },
  {
    name: "get_article",
    description: "Get a full article payload.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
    },
  },
  {
    name: "get_magazine",
    description: "Get a full magazine payload.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string" },
      },
      required: ["slug"],
    },
  },
];

// Filled in main(): month-precision issue dates (data/input/issue-dates.json) and built image sizes.
const ISSUE_DATES = new Map();
const IMAGE_SIZES = new Map();
let CONTENT_MODIFIED_AT = null;

const SITE_LOGO_ROUTE = "/assets/logo.png";
// Filled in main(): printed credits, verified facts, people registry, optional contact/legal config.
let EDITORIAL = { creditsByMagazine: new Map(), facts: [], contact: {}, legal: {} };
let PEOPLE = [];
const PEOPLE_BY_SLUG = new Map();
const ARTICLES_BY_SLUG = new Map();

function routeForStatic(site, locale, key) {
  return `${routePrefix(site, locale)}/${key}/`;
}

function routeForAuthor(site, locale, slug) {
  return `${routePrefix(site, locale)}/authors/${slug}/`;
}

function legalPagesEnabled() {
  return legalIsComplete(EDITORIAL.legal);
}

function personJsonLd(site, name, slug = null) {
  const person = slug ? PEOPLE_BY_SLUG.get(slug) : null;
  return person
    ? { "@type": "Person", "@id": `${baseUrl(site)}/authors/${person.slug}/#person`, name: person.name, url: `${baseUrl(site)}/authors/${person.slug}/` }
    : { "@type": "Person", name };
}

function organizationJsonLd(site) {
  return {
    "@type": "NewsMediaOrganization",
    "@id": `${baseUrl(site)}/#organization`,
    name: "proud magazine Berlin",
    alternateName: ["proud", site.siteTitle],
    url: `${baseUrl(site)}/`,
    logo: { "@type": "ImageObject", url: `${baseUrl(site)}${SITE_LOGO_ROUTE}`, width: 512, height: 512 },
  };
}

// Full organization entity for the home page: only verified identifiers and the policy pages that exist.
function organizationFullJsonLd(site, locale) {
  return {
    ...organizationJsonLd(site),
    sameAs: [DNB_URL, ISSUU_URL],
    identifier: { "@type": "PropertyValue", propertyID: "ZDB-ID", value: ZDB_ID },
    location: { "@type": "Place", name: "Berlin, Germany" },
    publishingPrinciples: `${baseUrl(site)}${routeForStatic(site, locale, "standards")}`,
    ethicsPolicy: `${baseUrl(site)}${routeForStatic(site, locale, "standards")}`,
    correctionsPolicy: `${baseUrl(site)}${routeForStatic(site, locale, "corrections")}`,
    masthead: `${baseUrl(site)}${routeForStatic(site, locale, "masthead")}`,
    // Publisher today (owner statement 2026-10-06): Emin Mahrt as a natural person. The issue-01 co-publishers
    // stay on the PublicationIssue as printed, not as the current operator.
    founder: personJsonLd(site, "Emin Henri Mahrt", "emin-henri-mahrt"),
  };
}

function currentPublisherJsonLd(site) {
  return { ...personJsonLd(site, "Emin Henri Mahrt", "emin-henri-mahrt"), alternateName: CURRENT_PUBLISHER };
}

function publisherJsonLd(site) {
  return organizationJsonLd(site);
}

function periodicalJsonLd(site) {
  return {
    "@type": "Periodical",
    "@id": `${baseUrl(site)}/#periodical`,
    name: "proud magazine Berlin",
    url: `${baseUrl(site)}/magazines/`,
    identifier: { "@type": "PropertyValue", propertyID: "ZDB-ID", value: ZDB_ID },
    sameAs: [DNB_URL],
    publisher: { "@id": `${baseUrl(site)}/#organization` },
  };
}

function breadcrumbJsonLd(site, items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: `${baseUrl(site)}${item.route}` })),
  };
}

function issueDateFor(magazineSlug) {
  return ISSUE_DATES.get(magazineSlug) ?? null;
}

function issueDateLabel(isoDate, locale) {
  if (!isoDate) {
    return "";
  }
  const [year, month] = isoDate.split("-");
  if (!month) {
    return year;
  }
  return new Intl.DateTimeFormat(isEnglishLocale(locale) ? "en-GB" : "de-DE", { month: "long", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(Number(year), Number(month) - 1, 1)));
}

function renderIssueTime(isoDate, locale) {
  return isoDate ? `<time datetime="${escapeHtml(isoDate)}">${escapeHtml(issueDateLabel(isoDate, locale))}</time>` : "";
}

// Only bylines printed in the article itself ("Text Firstname Lastname") count as authors.
// The ingest "authors" field also holds interviewees and masthead names, so it is not used for authorship.
function creditedAuthors(article) {
  const source = String(article?.bodyText ?? "");
  const names = [...source.matchAll(/^\s*Text\s+([A-ZÄÖÜ][\p{L}'.-]+(?:\s+[A-ZÄÖÜ][\p{L}'.-]+){1,2})\s*$/gmu)]
    .map((match) => match[1].trim())
    .filter((name) => !/^editor$/i.test(name));
  return [...new Set(names)];
}

function imgTag(src, alt, { priority = false } = {}) {
  const size = IMAGE_SIZES.get(src);
  const dims = size ? ` width="${size.width}" height="${size.height}"` : "";
  const loading = priority ? ' fetchpriority="high" decoding="async"' : ' loading="lazy" decoding="async"';
  return `<img src="${src}" alt="${alt}"${dims}${loading}>`;
}

function pagesLabel(copy, article) {
  const single = article.pages.start === article.pages.end;
  return `${single ? copy.page : copy.pages} ${pageRangeLabel(article)}`;
}

function normalizeForCompare(value) {
  return String(value ?? "").toLowerCase().replace(/…$/, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function baseUrl(site) {
  return `https://${site.domain}`;
}

function routePrefix(site, locale) {
  return locale === site.defaultLocale ? "" : `/${locale}`;
}

function routeForArticle(site, locale, slug) {
  return `${routePrefix(site, locale)}/articles/${slug}/`;
}

function routeForMagazine(site, locale, slug) {
  return `${routePrefix(site, locale)}/magazines/${slug}/`;
}

function homeRoute(site, locale) {
  return `${routePrefix(site, locale)}/`;
}

function routeForArticlesIndex(site, locale) {
  return `${routePrefix(site, locale)}/articles/`;
}

function routeForMagazinesIndex(site, locale) {
  return `${routePrefix(site, locale)}/magazines/`;
}

function routeForLlms(site, locale) {
  return `${routePrefix(site, locale)}/llms.txt`;
}

function routeForLlmsFull(site, locale) {
  return `${routePrefix(site, locale)}/llms-full.txt`;
}

function routeToFile(site, route) {
  return path.join(site.paths.siteOutputDir, route.replace(/^\/+/, ""));
}

async function ensureCleanDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
  const children = await fs.readdir(dirPath, { withFileTypes: true });
  await Promise.all(
    children
      .filter((child) => child.name !== ".gitkeep")
      .map(async (child) => {
        const target = path.join(dirPath, child.name);
        await fs.rm(target, { recursive: true, force: true });
      }),
  );
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function readOptionalJson(filePath) {
  try {
    return await readJson(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

async function loadArticleEnrichment(site, slug) {
  return readOptionalJson(path.join(site.paths.enrichmentDir, `${slug}.json`));
}

async function writeText(site, route, content) {
  const filePath = routeToFile(site, route);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, "utf8");
}

async function writeJson(site, route, payload) {
  await writeText(site, route, `${JSON.stringify(payload, null, 2)}\n`);
}

async function writePage(site, route, html, markdown) {
  const htmlRoute = route.endsWith("/") ? `${route}index.html` : route;
  const markdownRoute = route.endsWith("/") ? `${route}index.md` : route.replace(/\.html$/, ".md");
  await writeText(site, htmlRoute, html);
  await writeText(site, markdownRoute, markdown);
}

function articlePdfHref(article) {
  return `/assets/pdfs/${encodeURIComponent(article.sourcePdf)}#page=${article.pages.start}`;
}

function articlePreviewHref(article) {
  return article.previewImage ? `/assets/${optimizedImagePath(article.previewImage)}` : null;
}

function heroHref(article) {
  return article?.heroImage ? `/assets/${optimizedImagePath(article.heroImage)}` : null;
}

// Cropped hero cutout first, then legacy full-page preview scan, then first page image.
function articleCoverHref(article) {
  return heroHref(article) ?? articlePreviewHref(article) ?? articlePageImageHref(article?.pageImages?.[0]);
}

function articlePageImageHref(pageImage) {
  return pageImage?.image ? `/assets/${optimizedImagePath(pageImage.image)}` : null;
}

function optimizedImagePath(relativePath) {
  return String(relativePath ?? "").replace(IMAGE_EXTENSION_RE, ".webp");
}

function articleMarkdownRoute(site, locale, article) {
  return `${routeForArticle(site, locale, article.slug)}index.md`;
}

function magazineMarkdownRoute(site, locale, magazine) {
  return `${routeForMagazine(site, locale, magazine.slug)}index.md`;
}

function articleJsonRoute(article) {
  return `/api/articles/${encodeURIComponent(article.slug)}.json`;
}

function magazineJsonRoute(magazine) {
  return `/api/magazines/${encodeURIComponent(magazine.slug)}.json`;
}

function isEnglishLocale(locale) {
  return locale === "en";
}

function siteDescription(site, locale) {
  const publicDescription = pickLocalized(site.publicDescription, locale, site.defaultLocale);
  if (publicDescription) {
    return publicDescription;
  }

  if (isEnglishLocale(locale)) {
    return "Digital edition of the proud archive with stories on music, city life, nightlife, style, and Berlin.";
  }

  return site.description;
}

function pickLocalized(value, locale, fallback = "de") {
  if (value == null) {
    return null;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "object") {
    const direct = value[locale];
    if (direct != null) {
      return direct;
    }

    const fallbackValue = value[fallback];
    if (fallbackValue != null) {
      return fallbackValue;
    }

    const first = Object.values(value).find((entry) => entry != null);
    return first ?? null;
  }

  return null;
}

function ui(locale) {
  const english = isEnglishLocale(locale);

  return {
    articlesNav: english ? "Articles" : "Artikel",
    magazinesNav: english ? "Issues" : "Ausgaben",
    agentSkillsNav: "Skills",
    systemsNav: english ? "Archive access" : "Archivzugang",
    footerArchive: english
      ? "appears here as an open digital magazine archive."
      : "erscheint hier als offenes digitales Magazinarchiv.",
    read: english ? "Read" : "Lesen",
    readStory: english ? "Read story" : "Artikel lesen",
    issue: english ? "Issue" : "Heft",
    story: "",
    openIssue: english ? "Open issue" : "Ausgabe öffnen",
    openMagazine: english ? "To the issue" : "Zur Ausgabe",
    source: english ? "Source" : "Quelle",
    pages: english ? "Pages" : "Seiten",
    page: english ? "Page" : "Seite",
    pageLower: english ? "pages" : "Seiten",
    pageSingularLower: english ? "page" : "Seite",
    words: english ? "words" : "Wörter",
    scans: english ? "scans" : "Scans",
    articles: english ? "Articles" : "Artikel",
    language: english ? "Language" : "Sprache",
    originalLanguage: english ? "Original language" : "Originalsprache",
    languages: english ? "Languages" : "Sprachen",
    metadata: english ? "Details" : "Details",
    versions: english ? "Editions" : "Ausgaben",
    articleReview: english ? "Story" : "Geschichte",
    issueReview: english ? "Edition" : "Ausgabe",
    archiveReview: english ? "Front page" : "Titelseite",
    longestPieces: english ? "Longer pieces" : "Längere Stücke",
    allDetectedArticles: english ? "In this issue" : "In dieser Ausgabe",
    issueOrderNote: english
      ? "The sequence follows the printed issue, so every story stays close to its original editorial order."
      : "Die Reihenfolge folgt dem gedruckten Heft, damit jede Geschichte nahe an ihrer ursprünglichen Dramaturgie bleibt.",
    issueIntro: english
      ? "One complete edition in reading form: every story, every page span, and direct access back to the original printed issue."
      : "Eine komplette Ausgabe in Lesefassung: jede Geschichte, jede Seitenstrecke und der direkte Weg zurück ins originale Heft.",
    archiveIntro: english
      ? "A public reading edition of the archive with calm typography, linked sources, and faithful page references."
      : "Eine öffentliche Leseausgabe des Archivs mit ruhiger Typografie, verlinkten Quellen und präzisen Seitenbezügen.",
    listPageIntro: english
      ? "A curated way into the archive with stable reading pages, original scans, and clear routes through the issues."
      : "Ein kuratierter Zugang ins Archiv mit stabilen Leseseiten, Originalscans und klaren Wegen durch die Ausgaben.",
    machineReviewNote: english
      ? "Every article page exposes direct links to Markdown, JSON, and the original PDF for review and AI ingestion."
      : "Für Review und AI-Ingestion gibt es auf jeder Artikelseite direkte Links zu Markdown, JSON und Original-PDF.",
    articleTranslationState: english
      ? "This is the translated reading edition. The printed pages on the right remain the original version from the magazine."
      : "Dies ist die übersetzte Lesefassung. Die Druckseiten rechts bleiben die Originalversion aus dem Heft.",
    articleFallbackState: (targetLabel, originalLabel) =>
      english
        ? `There is no ${targetLabel} reading edition for this story yet. For now, the text below remains in the original ${originalLabel}, while the printed pages on the right stay unchanged.`
        : `Für diese Geschichte gibt es noch keine ${targetLabel}-Lesefassung. Bis dahin bleibt unten der ${originalLabel}-Originaltext, rechts unverändert die gedruckten Seiten.`,
    articleMergedState: english
      ? "The text below has been merged into one continuous reading edition. The printed pages on the right preserve the original layout of the issue."
      : "Der Text unten ist zu einer durchgehenden Lesefassung zusammengeführt. Die Druckseiten rechts bewahren den ursprünglichen Satzspiegel des Hefts.",
    untranslatedNote: (targetLabel, originalLabel) =>
      english
        ? `No ${targetLabel} translation exists yet. This page currently falls back to the original ${originalLabel} text.`
        : `Für ${targetLabel} gibt es hier noch keine Übersetzung. Diese Seite fällt aktuell auf den ${originalLabel}-Originaltext zurück.`,
    articleScans: english ? "Scans in article" : "Scans im Artikel",
    htmlReview: english ? "HTML Review" : "HTML Review",
    textEdition: english ? "Reading text" : "Lesetext",
    dataFile: english ? "Data sheet" : "Datenblatt",
    originalPdf: english ? "Original issue" : "Originalheft",
    issueMarkdown: english ? "Reading text" : "Lesetext",
    issueJson: english ? "Data sheet" : "Datenblatt",
    date: english ? "Date" : "Datum",
    published: english ? "Published" : "Erscheinung",
    edition: english ? "Edition" : "Ausgabe",
    recentArticles: english ? "Stories" : "Geschichten",
    magazineIndex: english ? "Editions" : "Ausgaben",
    archiveStats: english ? "At a glance" : "Im Überblick",
    issues: english ? "Issues" : "Ausgaben",
    longReads: english ? "Long Reads" : "Langtexte",
    latestIssue: english ? "This issue" : "Diese Ausgabe",
    archiveStories: english ? "Stories" : "Geschichten",
    editionDesk: english ? "In focus" : "Im Fokus",
    allArticles: english ? "Stories" : "Geschichten",
    allMagazines: english ? "Issues" : "Ausgaben",
    sortedByWordCount: english ? "By word count" : "Nach Wortzahl",
    inIssueOrder: english ? "In issue order" : "In Heftreihenfolge",
    inBrief: english ? "In brief" : "Kurzüberblick",
    formats: english ? "Read on" : "Weiterlesen",
    printedPages: english ? "Original pages" : "Originalseiten",
    furtherReading: english ? "Further reading" : "Weiterlesen",
    watchListen: english ? "Watch & Listen" : "Ansehen & Hören",
    relatedArchive: english ? "More from this issue" : "Mehr aus dieser Ausgabe",
    heroImageCaption: english ? "Original magazine spread" : "Originaler Heftausschnitt",
    heroCutoutCaption: english ? "From the magazine" : "Aus dem Heft",
    quickRead: english ? "In short" : "In Kürze",
    minutesRead: (minutes) => english ? `${minutes} min read` : `${minutes} Min. Lesezeit`,
    fromThisIssue: english ? "From this issue" : "Aus dieser Ausgabe",
    issueContents: english ? "Contents" : "Inhalt",
    previewFromPages: (pageRange, hiddenCount) =>
      english
        ? `Preview from pages ${pageRange}${hiddenCount > 0 ? ` · +${hiddenCount} more` : ""}`
        : `Vorschau aus Seiten ${pageRange}${hiddenCount > 0 ? ` · +${hiddenCount} weitere` : ""}`,
    articleScanPreview: (pageNumber) =>
      english
        ? `Article scan preview${pageNumber ? ` · Page ${pageNumber}` : ""}`
        : `Scan-Vorschau des Artikels${pageNumber ? ` · Seite ${pageNumber}` : ""}`,
    pageBadge: (pageNumber) => (english ? `Page ${pageNumber}` : `Seite ${pageNumber}`),
    pageAlt: (title, pageNumber) => `${title} ${english ? "page" : "Seite"} ${pageNumber}`,
    translationStatusNote: (targetLabel, originalLabel) =>
      english
        ? `> Translation status: untranslated. No ${targetLabel} translation exists yet. This page currently falls back to the original ${originalLabel} text.\n>\n`
        : `> Übersetzungsstatus: nicht übersetzt. Für ${targetLabel} gibt es hier noch keine Übersetzung. Diese Seite nutzt aktuell den ${originalLabel}-Originaltext.\n>\n`,
    missingShort: english ? "missing" : "fehlt",
    noRelatedLinks: english ? "No external references curated yet." : "Noch keine externen Hinweise kuratiert.",
    noVideos: english ? "No film or audio references curated yet." : "Noch keine Film- oder Audiohinweise kuratiert.",
  };
}

function localeLabelForUi(locale, uiLocale) {
  if (uiLocale === "de") {
    if (locale === "de") {
      return "Deutsch";
    }
    if (locale === "en") {
      return "Englisch";
    }
  }

  if (uiLocale === "en") {
    if (locale === "de") {
      return "German";
    }
    if (locale === "en") {
      return "English";
    }
  }

  return localeLabel(locale);
}

function formatCount(value, locale = "de") {
  return new Intl.NumberFormat(isEnglishLocale(locale) ? "en-US" : "de-DE").format(Number(value ?? 0));
}

function readingTimeMinutes(wordCount) {
  return Math.max(1, Math.ceil(Number(wordCount ?? 0) / 220));
}

function normalizeIssueSeed(value) {
  return String(value ?? "")
    .replace(/\.pdf$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\bissuu\s*output\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function issueNumberFromSeed(value) {
  const normalized = normalizeIssueSeed(value);
  const match = normalized.match(/^(\d{1,3})(?:\b|[-\s])/);
  return match ? match[1].padStart(2, "0") : null;
}

function displayMagazineTitle(magazineLike, locale) {
  const explicit = pickLocalized(magazineLike?.displayTitle, locale);
  if (explicit) {
    return explicit;
  }

  const issueNumber =
    issueNumberFromSeed(magazineLike?.title) ??
    issueNumberFromSeed(magazineLike?.magazineTitle) ??
    issueNumberFromSeed(magazineLike?.sourcePdf) ??
    issueNumberFromSeed(magazineLike?.slug);

  if (issueNumber) {
    return `proud #${issueNumber}`;
  }

  const cleaned =
    normalizeIssueSeed(magazineLike?.title) ||
    normalizeIssueSeed(magazineLike?.magazineTitle) ||
    normalizeIssueSeed(magazineLike?.sourcePdf) ||
    normalizeIssueSeed(magazineLike?.slug);

  return cleaned || (isEnglishLocale(locale) ? "Issue" : "Ausgabe");
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];

  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    output.push(item);
  }

  return output;
}

function extractExternalLinks(markdown) {
  const source = String(markdown ?? "");
  const matches = [...source.matchAll(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g)];
  return uniqueBy(
    matches.map((match) => ({
      title: match[1].trim(),
      url: match[2].trim(),
      source: null,
      note: null,
    })),
    (item) => item.url,
  );
}

function localizedLinkItems(items, locale) {
  return (items ?? []).map((item) => ({
    title: pickLocalized(item.title, locale) ?? item.title ?? item.url,
    url: item.url,
    source: pickLocalized(item.source, locale) ?? item.source ?? null,
    note: pickLocalized(item.note, locale) ?? item.note ?? null,
  }));
}

function localizedVideoItems(items, locale) {
  return (items ?? []).map((item) => ({
    title: pickLocalized(item.title, locale) ?? item.title ?? item.sourceUrl,
    embedUrl: item.embedUrl ?? null,
    sourceUrl: item.sourceUrl ?? null,
    provider: pickLocalized(item.provider, locale) ?? item.provider ?? null,
    caption: pickLocalized(item.caption, locale) ?? item.caption ?? null,
  })).filter((item) => item.embedUrl || item.sourceUrl);
}

function splitSummaryPoints(article, locale) {
  const source = String(displaySummaryForArticle(article, locale) ?? "").trim();
  if (!source) {
    return [];
  }

  const sentences = source
    .replace(/\s+/g, " ")
    .match(/[^.!?…]+(?:[.!?…]+|$)/g)
    ?.map((entry) => entry.trim())
    .filter(Boolean) ?? [];

  return sentences.slice(0, 3);
}

function selectPullQuote(articleBody) {
  const cleaned = String(articleBody ?? "")
    .replace(/^#{1,6}\s.+$/gm, "")
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "";
  }

  const quoted = cleaned.match(/[“"](.*?)[”"]/g)?.map((entry) => entry.replace(/[“”"]/g, "").trim()).find((entry) => entry.length >= 70 && entry.length <= 220);
  if (quoted) {
    return quoted;
  }

  const sentences = cleaned.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((entry) => entry.trim()).filter(Boolean) ?? [];
  const candidate = sentences.find((entry) => entry.length >= 110 && entry.length <= 220);
  return candidate ?? "";
}

function relatedArchiveArticles(article, articlePool, limit = 3) {
  return articlePool
    .filter((candidate) => candidate.slug !== article.slug && candidate.magazineSlug === article.magazineSlug)
    .sort((left, right) => {
      const leftDelta = Math.abs((left.pages.start ?? 0) - (article.pages.start ?? 0));
      const rightDelta = Math.abs((right.pages.start ?? 0) - (article.pages.start ?? 0));
      if (leftDelta !== rightDelta) {
        return leftDelta - rightDelta;
      }

      return (right.wordCount ?? 0) - (left.wordCount ?? 0);
    })
    .slice(0, limit);
}

function buildArticleEnrichment(localized, locale, articleBody, articlePool, manualEnrichment) {
  const quickPoints = splitSummaryPoints(localized, locale);
  const extractedLinks = extractExternalLinks(articleBody);
  const manualLinks = localizedLinkItems(manualEnrichment?.relatedLinks, locale);
  const relatedLinks = uniqueBy([...manualLinks, ...extractedLinks], (item) => item.url);
  const videos = localizedVideoItems(manualEnrichment?.videos, locale);
  const relatedArticles = relatedArchiveArticles(localized, articlePool);
  const rawTopics = pickLocalized(manualEnrichment?.topics, locale);

  return {
    kicker: pickLocalized(manualEnrichment?.kicker, locale) ?? null,
    heroCaption: pickLocalized(manualEnrichment?.heroCaption, locale) ?? null,
    topics: Array.isArray(rawTopics) ? rawTopics : rawTopics ? [String(rawTopics)] : [],
    quickPoints,
    pullQuote: selectPullQuote(articleBody),
    relatedLinks,
    videos,
    relatedArticles,
    readingTime: readingTimeMinutes(localized.wordCount),
  };
}

function withPresentationEnrichment(article, locale, articlePool, manualEnrichment) {
  const articleBody = buildPublishedArticleBody(article);
  return {
    ...article,
    presentation: buildArticleEnrichment(article, locale, articleBody, articlePool, manualEnrichment),
  };
}

function pageRangeLabel(article) {
  return article.pages.start === article.pages.end ? `${article.pages.start}` : `${article.pages.start}-${article.pages.end}`;
}

function sortArticlesForIssue(articles) {
  return [...articles].sort((left, right) => {
    if (left.pages.start !== right.pages.start) {
      return left.pages.start - right.pages.start;
    }

    if (left.pages.end !== right.pages.end) {
      return left.pages.end - right.pages.end;
    }

    return left.title.localeCompare(right.title, "de");
  });
}

function sortArticlesByWordCount(articles) {
  return [...articles].sort((left, right) => {
    if ((right.wordCount ?? 0) !== (left.wordCount ?? 0)) {
      return (right.wordCount ?? 0) - (left.wordCount ?? 0);
    }

    return left.title.localeCompare(right.title, "de");
  });
}

function renderActionButton(href, label, variant = "") {
  const className = variant ? `button-link ${variant}` : "button-link";
  return `<a class="${className}" href="${href}">${escapeHtml(label)}</a>`;
}

function renderTopicPills(topics) {
  if (!topics?.length) {
    return "";
  }

  return `
    <div class="topic-row">
      ${topics.map((topic) => `<span class="topic-pill">${escapeHtml(topic)}</span>`).join("")}
    </div>`;
}

function renderQuickPoints(copy, points) {
  if (!points?.length) {
    return "";
  }

  return `
    <section class="panel support-panel">
      <h3>${escapeHtml(copy.inBrief)}</h3>
      <ul class="link-list point-list">
        ${points.map((point) => `<li>${renderInlineMarkdown(point)}</li>`).join("")}
      </ul>
    </section>`;
}

function renderRelatedLinks(copy, links) {
  if (!links?.length) {
    return "";
  }

  return `
    <section class="panel support-panel">
      <h3>${escapeHtml(copy.furtherReading)}</h3>
      <ul class="link-list">
        ${links
          .map((item) => `
            <li>
              <a href="${item.url}">${escapeHtml(item.title)}</a>
              ${item.source ? `<div class="meta">${escapeHtml(item.source)}</div>` : ""}
              ${item.note ? `<div class="meta">${renderInlineMarkdown(item.note)}</div>` : ""}
            </li>`)
          .join("")}
      </ul>
    </section>`;
}

function renderVideos(copy, videos) {
  if (!videos?.length) {
    return "";
  }

  return `
    <section class="story-section">
      <div class="section-rule"></div>
      <h3>${escapeHtml(copy.watchListen)}</h3>
      <div class="video-grid">
        ${videos
          .map((video) => `
            <article class="video-card">
              ${video.embedUrl ? `<div class="video-frame"><iframe src="${video.embedUrl}" title="${escapeHtml(video.title)}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe></div>` : ""}
              <div class="video-card-body">
                <h4>${escapeHtml(video.title)}</h4>
                ${video.provider ? `<div class="meta">${escapeHtml(video.provider)}</div>` : ""}
                ${video.caption ? `<p>${renderInlineMarkdown(video.caption)}</p>` : ""}
                ${video.sourceUrl ? `<p><a href="${video.sourceUrl}">${escapeHtml(video.sourceUrl)}</a></p>` : ""}
              </div>
            </article>`)
          .join("")}
      </div>
    </section>`;
}

function renderRelatedArchive(copy, site, locale, articles) {
  if (!articles?.length) {
    return "";
  }

  return `
    <section class="story-section">
      <div class="section-rule"></div>
      <h3>${escapeHtml(copy.relatedArchive)}</h3>
      <div class="story-related-grid">
        ${articles
          .map((article) => `
            <article class="related-story">
              <h4><a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a></h4>
              <p class="meta">${escapeHtml(displayMagazineTitle(article, locale))} · ${escapeHtml(pagesLabel(copy, article))}</p>
              <p>${renderInlineMarkdown(visibleSummaryForArticle(article, locale))}</p>
            </article>`)
          .join("")}
      </div>
    </section>`;
}

function renderLeadStory(site, locale, article) {
  const copy = ui(locale);
  const previewHref = articleCoverHref(article);
  const summary = visibleSummaryForArticle(article, locale);
  const issueTitle = displayMagazineTitle(article, locale);

  return `
    <article class="lead-story">
      <div class="lead-story-copy">
        <h2><a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a></h2>
        <p class="deck">${renderInlineMarkdown(summary)}</p>
        <p class="meta">${escapeHtml(issueTitle)} · ${escapeHtml(pagesLabel(copy, article))} · ${escapeHtml(copy.minutesRead(readingTimeMinutes(article.wordCount)))}</p>
        ${renderActionButton(routeForArticle(site, locale, article.slug), copy.readStory, "primary")}
      </div>
      ${previewHref ? `
        <figure class="lead-story-art">
          <a href="${routeForArticle(site, locale, article.slug)}">${imgTag(previewHref, escapeHtml(article.title), { priority: true })}</a>
        </figure>` : ""}
    </article>`;
}

function renderStoryTeaser(site, locale, article) {
  const copy = ui(locale);
  const previewHref = articleCoverHref(article);
  const summary = visibleSummaryForArticle(article, locale);
  const issueTitle = displayMagazineTitle(article, locale);

  return `
    <article class="story-teaser">
      ${previewHref ? `<a class="story-teaser-art" href="${routeForArticle(site, locale, article.slug)}">${imgTag(previewHref, escapeHtml(article.title))}</a>` : ""}
      <h3><a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a></h3>
      <p class="meta">${escapeHtml(issueTitle)} · ${escapeHtml(pagesLabel(copy, article))}</p>
      <p>${renderInlineMarkdown(summary)}</p>
    </article>`;
}

function renderPreviewFigure(article, locale) {
  const copy = ui(locale);
  const pageImages = article.pageImages ?? [];
  if (pageImages.length > 1) {
    const visibleImages = pageImages.slice(0, 4);
    const hiddenCount = Math.max(0, pageImages.length - visibleImages.length);

    return `
    <figure class="hero-preview">
      <div class="hero-preview-grid">
        ${visibleImages
          .map((entry) => {
            const href = articlePageImageHref(entry);
            return `
            <a class="hero-preview-card" href="${href}">
              ${imgTag(href, escapeHtml(copy.pageAlt(article.title, entry.pageNumber)))}
              <span class="hero-preview-badge">${escapeHtml(copy.pageBadge(entry.pageNumber))}</span>
            </a>`;
          })
          .join("")}
      </div>
      <figcaption>${escapeHtml(copy.previewFromPages(pageRangeLabel(article), hiddenCount))}</figcaption>
    </figure>`;
  }

  const previewHref = articleCoverHref(article);
  if (!previewHref) {
    return "";
  }

  return `
    <figure class="hero-preview">
      <a href="${previewHref}">${imgTag(previewHref, escapeHtml(article.title))}</a>
      <figcaption>${escapeHtml(heroHref(article) ? copy.heroCutoutCaption : copy.articleScanPreview(pageImages[0]?.pageNumber))}</figcaption>
    </figure>`;
}

function renderArticleReviewCard(site, locale, article, { showMagazine = false } = {}) {
  const copy = ui(locale);
  const previewHref = articleCoverHref(article);
  const summary = visibleListSummaryForArticle(article, locale);
  const issueTitle = displayMagazineTitle(article, locale);
  const mediaClass = previewHref ? "article-card with-media" : "article-card";
  const magazineLine = showMagazine
    ? `<p class="meta">${escapeHtml(issueTitle)} · ${escapeHtml(pagesLabel(copy, article))}</p>`
    : `<p class="meta">${escapeHtml(pagesLabel(copy, article))} · ${formatCount(article.wordCount, locale)} ${escapeHtml(copy.words)}</p>`;

  return `
    <li class="${mediaClass}">
      ${previewHref ? `
        <div class="article-card-media">
          <figure>
            <a href="${routeForArticle(site, locale, article.slug)}">${imgTag(previewHref, escapeHtml(article.title))}</a>
          </figure>
          <div class="meta">${escapeHtml(heroHref(article) ? copy.heroCutoutCaption : copy.heroImageCaption)} · ${escapeHtml(pagesLabel(copy, article))}</div>
        </div>` : ""}
      <div class="article-card-body">
        <div class="article-card-header">
          <div>
            <h3><a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a></h3>
            ${magazineLine}
          </div>
        </div>
        ${summary ? `<p>${renderInlineMarkdown(summary)}</p>` : ""}
        <div class="stat-row">
          <span class="stat-chip"><strong>${formatCount(article.wordCount, locale)}</strong> ${escapeHtml(copy.words)}</span>
          <span class="stat-chip"><strong>${pageRangeLabel(article)}</strong> ${escapeHtml(article.pages.start === article.pages.end ? copy.page : copy.pages)}</span>
          <span class="stat-chip"><strong>${formatCount(article.pageImages?.length ?? 0, locale)}</strong> ${escapeHtml(copy.scans)}</span>
        </div>
        <div class="action-row review-actions">
          ${renderActionButton(routeForArticle(site, locale, article.slug), copy.readStory, "primary")}
        </div>
      </div>
    </li>`;
}

function renderMagazineReviewCard(site, locale, magazine) {
  const copy = ui(locale);
  const issueTitle = displayMagazineTitle(magazine, locale);
  const metaParts = [
    issueDateFor(magazine.slug) ? issueDateLabel(issueDateFor(magazine.slug), locale) : null,
    `${formatCount(magazine.pageCount, locale)} ${copy.pages}`,
    `${formatCount(magazine.articleCount, locale)} ${copy.articles}`,
  ].filter(Boolean);
  return `
    <li class="issue-card">
      <div class="issue-card-header">
        <div>
          <h3><a href="${routeForMagazine(site, locale, magazine.slug)}">${escapeHtml(issueTitle)}</a></h3>
          <p class="meta">${escapeHtml(metaParts.join(" · "))}</p>
        </div>
      </div>
      <div class="action-row review-actions">
        ${renderActionButton(routeForMagazine(site, locale, magazine.slug), copy.openIssue, "primary")}
      </div>
    </li>`;
}

function dateLabel(value, locale = "de") {
  return value ?? (isEnglishLocale(locale) ? "unknown" : "unbekannt");
}

function normalizeTextBlock(value) {
  return String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripRepeatedLeadingTitle(article, text) {
  let normalized = normalizeTextBlock(text);
  if (!normalized) {
    return "";
  }

  const escapedTitle = normalizeTextBlock(article.title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  normalized = normalized.replace(new RegExp(`^${escapedTitle}(?:\\s+|\\s*[:.-]+\\s*)`, "i"), "");

  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return normalized;
  }

  if (lines[0].toLowerCase() === normalizeTextBlock(article.title).toLowerCase()) {
    lines.shift();
  }

  return lines.join("\n").trim();
}

function sentenceSummaryFromText(text, sentenceLimit = 2, maxLength = 420) {
  const source = normalizeTextBlock(text).replace(/\n+/g, " ");
  if (!source) {
    return "";
  }

  const sentences = source.match(/[^.!?…]+(?:[.!?…]+|$)/g)?.map((entry) => entry.trim()).filter(Boolean) ?? [];
  const picked = sentences.slice(0, sentenceLimit).join(" ").trim();
  const summary = picked || source;
  if (summary.length <= maxLength) {
    return summary;
  }

  return `${summary.slice(0, maxLength).trimEnd()}…`;
}

function hrefForBareLink(value) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return null;
  }

  if (/^(https?:\/\/|mailto:)/i.test(raw)) {
    return raw;
  }

  if (/^www\./i.test(raw) || /^(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:[/?#][^\s]*)?$/i.test(raw)) {
    return `https://${raw}`;
  }

  return null;
}

function linkifyInlineMarkdown(text) {
  const pattern = /\b((?:https?:\/\/|www\.)[^\s<]+|(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s<]*)?)/gi;
  return String(text ?? "").replace(pattern, (matched) => {
    let bare = matched;
    let trailing = "";

    while (/[),.;:!?]$/.test(bare)) {
      trailing = bare.slice(-1) + trailing;
      bare = bare.slice(0, -1);
    }

    const href = hrefForBareLink(bare);
    if (!href) {
      return matched;
    }

    return `[${bare}](${href})${trailing}`;
  });
}

function formatMarkdownForPublishing(markdown) {
  const lines = String(markdown ?? "").replace(/\r/g, "").split("\n");
  const output = [];
  const pendingLinks = [];
  const linkLinePattern = /^(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,24}(?:\/[^\s]*)?)$/i;

  function flushLinks() {
    if (pendingLinks.length === 0) {
      return;
    }

    for (const entry of pendingLinks) {
      const href = hrefForBareLink(entry);
      output.push(href ? `- [${entry}](${href})` : entry);
    }

    pendingLinks.length = 0;
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    const trimmed = line.trim();

    if (!trimmed) {
      flushLinks();
      if (output.at(-1) !== "") {
        output.push("");
      }
      continue;
    }

    if (linkLinePattern.test(trimmed)) {
      pendingLinks.push(trimmed);
      continue;
    }

    flushLinks();
    output.push(linkifyInlineMarkdown(line));
  }

  flushLinks();
  return `${output.join("\n").replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function isLikelyQuestionLine(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return false;
  }

  if (!trimmed.endsWith("?")) {
    return false;
  }

  if (trimmed.length > 220) {
    return false;
  }

  return !/^(?:#{1,6}\s|[-*]\s|\d+\.\s|>)/.test(trimmed);
}

function normalizeInterviewMarkdown(markdown) {
  const lines = String(markdown ?? "").split("\n");
  const output = [];

  for (let index = 0; index < lines.length; ) {
    const line = lines[index];
    const trimmed = line.trim();

    if (!trimmed) {
      if (output.at(-1) !== "") {
        output.push("");
      }
      index += 1;
      continue;
    }

    if (isLikelyQuestionLine(trimmed)) {
      output.push(`### ${trimmed}`);
      output.push("");
      index += 1;

      const answerLines = [];
      while (index < lines.length) {
        const nextLine = lines[index];
        const nextTrimmed = nextLine.trim();

        if (!nextTrimmed) {
          if (answerLines.length > 0) {
            index += 1;
            break;
          }
          index += 1;
          continue;
        }

        if (/^#{1,6}\s/.test(nextTrimmed) || isLikelyQuestionLine(nextTrimmed)) {
          break;
        }

        answerLines.push(nextLine.trimEnd());
        index += 1;
      }

      if (answerLines.length > 0) {
        output.push(...answerLines);
        output.push("");
      }
      continue;
    }

    output.push(line.trimEnd());
    index += 1;
  }

  return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildPublishedArticleBody(article) {
  const rawSource =
    article.translationState === "translated"
      ? article.markdown ?? article.bodyText ?? ""
      : Array.isArray(article.contentBlocks) && article.contentBlocks.length > 0
        ? article.contentBlocks.map((block) => block.markdown ?? block.text ?? "").join("\n\n")
        : article.markdown ?? article.bodyText ?? "";

  const lines = formatMarkdownForPublishing(rawSource).split("\n");
  const cleaned = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      if (cleaned.at(-1) !== "") {
        cleaned.push("");
      }
      continue;
    }

    if (/^>\s*(Quelle|Source|Autor:innen|Authors?:)/i.test(trimmed)) {
      continue;
    }

    if (/^##\s+(Seite|Page)\s+\d+/i.test(trimmed) || /^(?:PAGE|SEITE)\s+\d+$/i.test(trimmed)) {
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const headingText = normalizeTextBlock(headingMatch[2]);
      if (headingText.toLowerCase() === normalizeTextBlock(article.title).toLowerCase()) {
        continue;
      }

      const level = Math.max(3, headingMatch[1].length);
      cleaned.push(`${"#".repeat(Math.min(level, 6))} ${headingMatch[2].trim()}`);
      continue;
    }

    cleaned.push(line.trimEnd());
  }

  return normalizeInterviewMarkdown(cleaned.join("\n"));
}

function displaySummaryForArticle(article, locale) {
  const summary = normalizeTextBlock(article.summary);
  if (article.translationState === "translated" && summary && !isGeneratedArchiveSummary(summary, article)) {
    return summary;
  }

  const publishedBodyParagraph = buildPublishedArticleBody(article)
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .find((chunk) => {
      if (!chunk) {
        return false;
      }

      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      if (lines.length === 0) {
        return false;
      }

      return lines.some((line) => !/^#{1,6}\s/.test(line) && !/^>\s/.test(line) && !/^(?:[-*]|\d+\.)\s/.test(line));
    });

  const publishedBodySummary = sentenceSummaryFromText(
    stripRepeatedLeadingTitle(
      article,
      String(publishedBodyParagraph ?? "")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed && !/^#{1,6}\s/.test(trimmed) && !/^>\s/.test(trimmed) && !/^(?:[-*]|\d+\.)\s/.test(trimmed);
        })
        .join(" "),
    ),
    2,
    360,
  );
  if (publishedBodySummary) {
    return publishedBodySummary;
  }

  const excerptFallback = sentenceSummaryFromText(stripRepeatedLeadingTitle(article, article.excerpt), 2, 360);
  if (excerptFallback) {
    return excerptFallback;
  }

  return sentenceSummaryFromText(stripRepeatedLeadingTitle(article, article.bodyText), 3, 420);
}

function displayHeroSummaryForArticle(article, locale) {
  const articleBody = buildPublishedArticleBody(article)
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1");
  const publishedBodyParagraph = articleBody
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .find((chunk) => {
      if (!chunk) {
        return false;
      }

      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      return lines.some((line) => !/^#{1,6}\s/.test(line) && !/^>\s/.test(line) && !/^(?:[-*]|\d+\.)\s/.test(line));
    });

  const publishedBodySummary = sentenceSummaryFromText(
    stripRepeatedLeadingTitle(
      article,
      String(publishedBodyParagraph ?? "")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed && !/^#{1,6}\s/.test(trimmed) && !/^>\s/.test(trimmed) && !/^(?:[-*]|\d+\.)\s/.test(trimmed);
        })
        .join(" "),
    ),
    4,
    760,
  );
  if (publishedBodySummary) {
    return publishedBodySummary;
  }

  const summary = displaySummaryForArticle(article, locale);
  return isGeneratedArchiveSummary(summary, article) ? "" : summary;
}

function visibleSummaryForArticle(article, locale) {
  const summary = displaySummaryForArticle(article, locale);
  return isGeneratedArchiveSummary(summary, article) ? "" : summary;
}

function visibleListSummaryForArticle(article, locale) {
  const publishedBodyParagraph = buildPublishedArticleBody(article)
    .replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\n{2,}/)
    .map((chunk) => chunk.trim())
    .find((chunk) => {
      const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
      return lines.some((line) => !/^#{1,6}\s/.test(line) && !/^>\s/.test(line) && !/^(?:[-*]|\d+\.)\s/.test(line));
    });

  const fromBody = sentenceSummaryFromText(
    stripRepeatedLeadingTitle(
      article,
      String(publishedBodyParagraph ?? "")
        .split("\n")
        .filter((line) => {
          const trimmed = line.trim();
          return trimmed && !/^#{1,6}\s/.test(trimmed) && !/^>\s/.test(trimmed) && !/^(?:[-*]|\d+\.)\s/.test(trimmed);
        })
        .join(" "),
    ),
    3,
    560,
  );

  if (fromBody && !isGeneratedArchiveSummary(fromBody, article)) {
    return fromBody;
  }

  return visibleSummaryForArticle(article, locale);
}

function isGeneratedArchiveSummary(summary, article) {
  const normalized = normalizeTextBlock(summary).toLowerCase();
  const title = normalizeTextBlock(article?.title).toLowerCase();
  return (
    /^dieser artikel aus dem magazin\b/.test(normalized) ||
    /^dieser artikel\b/.test(normalized) ||
    /^this article from the magazine\b/.test(normalized) ||
    /^this article\b/.test(normalized) ||
    normalized.includes("issuu_output") ||
    (title && normalized.includes(`stellt "${title}" vor`))
  );
}

function frontmatter(fields) {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    lines.push(`${key}: ${JSON.stringify(value)}`);
  }
  lines.push("---", "");
  return lines.join("\n");
}

function highlightProudTextNodes(html) {
  let insideScriptOrStyle = false;

  return String(html ?? "")
    .split(/(<[^>]+>)/g)
    .map((part) => {
      if (!part) {
        return "";
      }

      if (part.startsWith("<")) {
        const tag = part.toLowerCase();
        if (/^<\s*(script|style)\b/.test(tag)) {
          insideScriptOrStyle = true;
        } else if (/^<\s*\/\s*(script|style)\b/.test(tag)) {
          insideScriptOrStyle = false;
        }
        return part;
      }

      if (insideScriptOrStyle) {
        return part;
      }

      return part.replace(/proud/gi, (match) => `<span class="proud-word">${match}</span>`);
    })
    .join("");
}

function renderLayout(site, {
  locale,
  title,
  description,
  route,
  canonicalRoute = route,
  markdownRoute,
  body,
  bodyClass = "",
  alternates = [],
  structuredData = null,
  socialImage = null,
  socialType = "website",
  socialTitle = title,
  socialDescription = description,
  issueDate = null,
  navCurrent = null,
}) {
  const copy = ui(locale);
  const canonical = `${baseUrl(site)}${canonicalRoute}`;
  const datelineHtml = issueDate ? renderIssueTime(issueDate, locale) : escapeHtml(isEnglishLocale(locale) ? "Archive" : "Archiv");
  const socialImageUrl = socialImage ? `${baseUrl(site)}${socialImage}` : null;
  const ogLocale = locale === "de" ? "de_DE" : locale === "en" ? "en_US" : locale;
  const defaultAlternate = alternates.find((entry) => entry.locale === site.defaultLocale);
  const headAlternates = [
    ...alternates.map((entry) => `<link rel="alternate" hreflang="${entry.locale}" href="${baseUrl(site)}${entry.route}">`),
    ...(defaultAlternate ? [`<link rel="alternate" hreflang="x-default" href="${baseUrl(site)}${defaultAlternate.route}">`] : []),
  ].join("\n    ");
  const ogAlternateLocales = alternates
    .filter((entry) => entry.locale !== locale)
    .map((entry) => `<meta property="og:locale:alternate" content="${escapeHtml(entry.locale === "de" ? "de_DE" : entry.locale === "en" ? "en_US" : entry.locale)}">`)
    .join("\n");
  const jsonLd = structuredData
    ? `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`
    : "";
  const visibleBody = highlightProudTextNodes(body);
  const visibleSiteTitle = highlightProudTextNodes(escapeHtml(site.siteTitle));
  const visibleDescription = highlightProudTextNodes(escapeHtml(siteDescription(site, locale)));
  const visibleFooter = highlightProudTextNodes(`${escapeHtml(site.siteTitle)} ${escapeHtml(copy.footerArchive)}`);

  return `<!doctype html>
<html lang="${escapeHtml(locale)}">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}">
    <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">
    <meta name="theme-color" content="#f8f3ea">
    <link rel="canonical" href="${canonical}">
    <link rel="alternate" type="text/markdown" href="${baseUrl(site)}${markdownRoute}">
    <link rel="webmcp" href="${baseUrl(site)}/.well-known/webmcp.json">
    <link rel="ai-catalog" href="/.well-known/ai-catalog.json">
    <link rel="icon" href="/favicon.ico" sizes="32x32">
    <link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/assets/fonts/barlow-latin-700-normal.woff2" as="font" type="font/woff2" crossorigin>
    ${headAlternates}
    <meta property="og:type" content="${escapeHtml(socialType)}">
    <meta property="og:site_name" content="${escapeHtml(site.siteTitle)}">
    <meta property="og:title" content="${escapeHtml(socialTitle)}">
    <meta property="og:description" content="${escapeHtml(socialDescription)}">
    <meta property="og:url" content="${canonical}">
    <meta property="og:locale" content="${escapeHtml(ogLocale)}">
    ${ogAlternateLocales}
    ${socialImageUrl ? `<meta property="og:image" content="${escapeHtml(socialImageUrl)}">` : ""}
    <meta name="twitter:card" content="${socialImageUrl ? "summary_large_image" : "summary"}">
    <meta name="twitter:title" content="${escapeHtml(socialTitle)}">
    <meta name="twitter:description" content="${escapeHtml(socialDescription)}">
    ${socialImageUrl ? `<meta name="twitter:image" content="${escapeHtml(socialImageUrl)}">` : ""}
    <link rel="stylesheet" href="/assets/site.css">
    ${jsonLd}
  </head>
  <body${bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ""}>
    <main>
      ${renderMastheadHeader(site, locale, { alternates, navCurrent })}
      ${visibleBody}
      ${renderSiteFooter(site, locale)}
    </main>
    <script src="/assets/webmcp.js" defer></script>
  </body>
</html>`;
}

function navItems(site, locale) {
  const en = isEnglishLocale(locale);
  return [
    ["articles", routeForArticlesIndex(site, locale), en ? "Articles" : "Artikel"],
    ["issues", routeForMagazinesIndex(site, locale), en ? "Issues" : "Ausgaben"],
    ["authors", routeForStatic(site, locale, "authors"), en ? "Authors" : "Autor:innen"],
    ["about", routeForStatic(site, locale, "about"), en ? "About" : "Über proud"],
    ["masthead", routeForStatic(site, locale, "masthead"), en ? "Masthead" : "Redaktion"],
  ];
}

function renderMastheadHeader(site, locale, { alternates = [], navCurrent = null } = {}) {
  const en = isEnglishLocale(locale);
  const other = (alternates ?? []).find((entry) => entry.locale !== locale);
  const otherLocale = other?.locale ?? (en ? "de" : "en");
  const otherRoute = other?.route ?? homeRoute(site, otherLocale);
  const langLabel = otherLocale === "en" ? "English" : "Deutsch";
  return `<div class="masthead-strip">
        <span>${escapeHtml(en ? "Archive edition: Berlin 2009–2014" : "Archiv-Ausgabe: Berlin 2009–2014")}</span>
        <a href="${otherRoute}" hreflang="${otherLocale}" lang="${otherLocale}">${escapeHtml(langLabel)}</a>
      </div>
      <header class="site-header masthead">
        <p class="wordmark"><a href="${homeRoute(site, locale)}" aria-label="proud. ${escapeHtml(en ? "home" : "Startseite")}">proud.</a></p>
        <p class="wordmark-sub">magazine Berlin</p>
        <nav class="sections" aria-label="${escapeHtml(en ? "Sections" : "Rubriken")}">
          ${navItems(site, locale)
            .map(([key, href, label]) => `<a href="${href}"${key === navCurrent ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`)
            .join("\n          ")}
        </nav>
      </header>`;
}

function renderSiteFooter(site, locale) {
  const en = isEnglishLocale(locale);
  const links = [
    ["about", en ? "About" : "Über proud"],
    ["masthead", en ? "Masthead" : "Redaktion"],
    ["standards", en ? "Editorial standards" : "Grundsätze"],
    ["press", en ? "Press" : "Presse"],
    ["archive-guide", en ? "Archive guide" : "Archiv-Leitfaden"],
    ["corrections", en ? "Corrections" : "Korrekturen"],
    ...(legalPagesEnabled() ? [["impressum", en ? "Legal notice" : "Impressum"], ["datenschutz", en ? "Privacy" : "Datenschutz"]] : []),
  ];
  return `<footer class="site-footer">
        <p class="footer-brand">proud.</p>
        <ul class="footer-columns">
          ${links.map(([key, label]) => `<li><a href="${routeForStatic(site, locale, key)}">${escapeHtml(label)}</a></li>`).join("\n          ")}
        </ul>
        <p class="trust-line">${escapeHtml(en ? `Publisher today: ${CURRENT_PUBLISHER}` : `Herausgeber heute: ${CURRENT_PUBLISHER}`)}<br>${en
          ? `Archived in the German National Library (<a href="${DNB_URL}">${DNB_SHELF} · ZDB ${ZDB_ID}</a>)`
          : `Archiviert in der Deutschen Nationalbibliothek (<a href="${DNB_URL}">${DNB_SHELF} · ZDB ${ZDB_ID}</a>)`}</p>
      </footer>`;
}

function buildArticleMarkdown(site, localized, locale, articlePool, manualEnrichment = null) {
  const copy = ui(locale);
  const articleBody = buildPublishedArticleBody(localized);
  const tldr = displaySummaryForArticle(localized, locale);
  const issueDate = issueDateFor(localized.magazineSlug);
  const mdByline = bylineFor(EDITORIAL, localized, PEOPLE_BY_SLUG, locale);
  const authors = mdByline.authors.map((entry) => entry.name);
  const creditLine = mdByline.secondary.map((entry) => `${entry.label}: ${entry.name}`).join(" · ");
  const contentLocale = articleContentLocale(localized);
  const contentLocaleLabel = localeLabelForUi(contentLocale, locale);
  const enrichment = localized.presentation ?? buildArticleEnrichment(localized, locale, articleBody, articlePool, manualEnrichment);
  const note =
    localized.translationState === "untranslated"
      ? copy.translationStatusNote(localeLabelForUi(locale, locale), contentLocaleLabel)
      : "";
  const quickPoints = enrichment.quickPoints.length
    ? `## ${copy.inBrief}\n\n${enrichment.quickPoints.map((point) => `- ${point}`).join("\n")}\n\n`
    : "";
  const linksSection = enrichment.relatedLinks.length
    ? `## ${copy.furtherReading}\n\n${enrichment.relatedLinks.map((item) => `- [${item.title}](${item.url})${item.note ? `: ${String(item.note).replace(/\n+/g, " ")}` : ""}`).join("\n")}\n\n`
    : "";
  const videosSection = enrichment.videos.length
    ? `## ${copy.watchListen}\n\n${enrichment.videos.map((item) => `- [${item.title}](${item.sourceUrl ?? item.embedUrl})${item.caption ? `: ${String(item.caption).replace(/\n+/g, " ")}` : ""}`).join("\n")}\n\n`
    : "";
  const relatedSection = enrichment.relatedArticles.length
    ? `## ${copy.relatedArchive}\n\n${enrichment.relatedArticles.map((item) => `- [${item.title}](${baseUrl(site)}${routeForArticle(site, locale, item.slug)}index.md): ${displaySummaryForArticle(item, locale)}`).join("\n")}\n\n`
    : "";

  return (
    frontmatter({
      title: localized.title,
      slug: localized.slug,
      locale,
      original_locale: localized.originalLocale,
      detected_language: localized.detectedLanguage,
      translation_state: localized.translationState,
      canonical_url: `${baseUrl(site)}${articleCanonicalRoute(site, localized)}`,
      pdf_url: `${baseUrl(site)}${articlePdfHref(localized)}`,
      preview_image_url: articleCoverHref(localized) ? `${baseUrl(site)}${articleCoverHref(localized)}` : null,
      page_image_count: localized.pageImages?.length ?? 0,
      reading_time_minutes: enrichment.readingTime,
      magazine_slug: localized.magazineSlug,
      magazine_title: localized.magazineTitle,
      issue_date: issueDate,
      source_pdf: localized.sourcePdf,
      pages: `${localized.pages.start}-${localized.pages.end}`,
      authors: mdByline.authors.map((entry) => entry.name),
    }) +
    note +
    (tldr ? `## TL;DR\n\n${tldr}\n\n` : "") +
    quickPoints +
    `# ${localized.title}\n\n` +
    `> ${copy.source}: ${localized.magazineTitle}, ${localized.pages.start === localized.pages.end ? copy.pageSingularLower : copy.pageLower} ${pageRangeLabel(localized)}\n` +
    `${issueDate ? `> ${locale === "en" ? "Issue date" : "Erschienen"}: ${issueDateLabel(issueDate, locale)}\n` : ""}` +
    `${authors.length ? `> ${locale === "en" ? "By" : "Von"}: ${authors.join(", ")}\n` : ""}` +
    `${creditLine ? `> ${creditLine}\n` : ""}\n` +
    `${articleBody}\n\n` +
    videosSection +
    linksSection +
    relatedSection
  );
}

function renderAlternates(site, articleOrMagazine, routeBuilder, locales) {
  return locales.map((locale) => ({
    locale,
    route: routeBuilder(site, locale, articleOrMagazine.slug),
  }));
}

function articleContentLocale(article) {
  return article.translationState === "translated"
    ? article.locale
    : article.originalLocale ?? article.detectedLanguage ?? article.locale;
}

function articleLocaleState(article, locale) {
  if (locale === article.originalLocale) {
    return "original";
  }

  return (article.availableLocales ?? []).includes(locale) ? "translated" : "missing";
}

function articleCanonicalRoute(site, article) {
  return article.translationState === "untranslated"
    ? routeForArticle(site, articleContentLocale(article), article.slug)
    : routeForArticle(site, article.locale, article.slug);
}

function articleAlternateEntries(site, article, locales) {
  return locales
    .filter((locale) => articleLocaleState(article, locale) !== "missing")
    .map((locale) => ({
      locale,
      route: routeForArticle(site, locale, article.slug),
    }));
}

function renderArticleLocaleNav(site, article, locales, currentLocale) {
  const copy = ui(currentLocale);

  return locales
    .map((locale) => {
      const status = articleLocaleState(article, locale);
      const label = localeLabelForUi(locale, currentLocale);
      if (status === "missing") {
        return `<span class="locale-chip missing">${escapeHtml(`${label} ${copy.missingShort}`)}</span>`;
      }

      const href = routeForArticle(site, locale, article.slug);
      const className = locale === currentLocale ? "locale-chip current" : "locale-chip";
      const currentAttr = locale === currentLocale ? ' aria-current="page"' : "";
      return `<a class="${className}" href="${href}"${currentAttr}>${escapeHtml(label)}</a>`;
    })
    .join("");
}

function buildArticleHtml(site, localized, locale, locales, articlePool, manualEnrichment = null) {
  const copy = ui(locale);
  const previewHref = articleCoverHref(localized);
  const articleBody = buildPublishedArticleBody(localized);
  const contentLocale = articleContentLocale(localized);
  const contentLocaleLabel = localeLabelForUi(contentLocale, locale);
  const enrichment = localized.presentation ?? buildArticleEnrichment(localized, locale, articleBody, articlePool, manualEnrichment);
  const issueTitle = displayMagazineTitle(localized, locale);
  const articleHero = heroHref(localized);
  const pageGallery = (localized.pageImages ?? [])
    .map((entry, index) => {
      const href = articlePageImageHref(entry);
      return `
        <figure class="page-card">
          <a href="${href}">${imgTag(href, escapeHtml(copy.pageAlt(localized.title, entry.pageNumber)), { priority: !articleHero && index === 0 })}</a>
          <figcaption class="meta">${escapeHtml(copy.pageBadge(entry.pageNumber))}</figcaption>
        </figure>`;
    })
    .join("");
  const topScansClass = (localized.pageImages?.length ?? 0) === 1 ? "article-top-scans single" : "article-top-scans";
  const topScans = pageGallery
    ? `
    <section class="${topScansClass}" id="original-pages" aria-label="${escapeHtml(copy.printedPages)}">
      <div class="page-gallery">${pageGallery}</div>
    </section>`
    : "";
  const translationNote =
    localized.translationState === "untranslated"
      ? `<div class="translation-note"><strong>${escapeHtml(localeLabelForUi(locale, locale))}:</strong> ${escapeHtml(copy.untranslatedNote(localeLabelForUi(locale, locale), contentLocaleLabel))}</div>`
      : "";
  const sourcePanel = "";
  const articleSummary = displayHeroSummaryForArticle(localized, locale);
  const tldr = displaySummaryForArticle(localized, locale);
  const issueDate = issueDateFor(localized.magazineSlug);
  const authors = creditedAuthors(localized);
  // The hero summary is cut from the first body paragraph, so it would repeat the text right below.
  // Show the TL;DR as its own block only when it is not just that same opening paragraph.
  const bodyOpening = normalizeForCompare(articleBody.replace(/^#{1,6}\s.*$/gm, "").replace(/\[[^\]]+\]\(([^)]+)\)/g, "$1").replace(/`([^`]+)`/g, "$1"));
  const tldrIsBodyEcho = !tldr || bodyOpening.startsWith(normalizeForCompare(tldr).slice(0, 120));
  const articleSummaryHtml = tldr && !tldrIsBodyEcho && !isGeneratedArchiveSummary(tldr, localized)
    ? `\n          <section class="tldr" aria-label="TL;DR"><span class="tldr-label">TL;DR</span><p class="lede">${renderInlineMarkdown(tldr)}</p></section>`
    : "";
  const topicPills = renderTopicPills(enrichment.topics);
  const byline = bylineFor(EDITORIAL, localized, PEOPLE_BY_SLUG, locale);
  const photoCredits = byline.secondary.filter((credit) => credit.role === "photo");
  const articleHeroFigure = articleHero
    ? `
        <figure class="article-figure">
          ${imgTag(articleHero, escapeHtml(localized.title), { priority: true })}
          <figcaption><span>${escapeHtml(copy.heroCutoutCaption)}, ${escapeHtml(issueTitle)}, ${escapeHtml(pagesLabel(copy, localized))}</span>${photoCredits.length ? `<span class="photo-credit">${escapeHtml(photoCredits.map((credit) => `${credit.label}: ${credit.name}`).join(" · "))}</span>` : ""}</figcaption>
        </figure>`
    : "";
  const videosSection = renderVideos(copy, enrichment.videos);
  const relatedArchiveSection = renderRelatedArchive(copy, site, locale, enrichment.relatedArticles);

  const en = isEnglishLocale(locale);
  const rubric = articleRubric(localized);
  const deck = articleDeck(localized, locale);
  const nameHtml = (entry) => entry.slug ? `<a href="${routeForAuthor(site, locale, entry.slug)}">${escapeHtml(entry.name)}</a>` : escapeHtml(entry.name);
  const bylineHtml = byline.authors.length
    ? `<p class="byline">${escapeHtml(en ? "By" : "Von")} ${byline.authors.map(nameHtml).join(byline.authors.length === 2 ? (en ? " and " : " und ") : ", ")}${byline.authors.some((entry) => entry.guest) ? ` <span class="byline-credits">(${escapeHtml(en ? "guest author" : "Gastautor")})</span>` : ""}</p>`
    : "";
  const secondaryHtml = byline.secondary.length
    ? `<p class="byline-credits">${byline.secondary.map((entry) => `${escapeHtml(entry.label)}: ${nameHtml(entry)}`).join(" · ")}</p>`
    : "";
  const datelineHtml = `<p class="dateline">Berlin${issueDate ? ` · ${renderIssueTime(issueDate, locale)}` : ""} · ${escapeHtml(en ? "Issue" : "Heft")} ${escapeHtml(issueNumberFromSeed(localized.magazineTitle) ?? "")}, ${escapeHtml(localized.pages.start === localized.pages.end ? copy.page : copy.pages)} ${escapeHtml(pageRangeLabel(localized).replace("-", "–"))} · ${escapeHtml(copy.minutesRead(enrichment.readingTime)).replace(/ /g, "\u00a0")}</p>`;
  const linkedPeople = [...byline.authors, ...byline.secondary].filter((entry) => entry.slug).map((entry) => PEOPLE_BY_SLUG.get(entry.slug));
  const uniquePeople = [...new Map(linkedPeople.map((person) => [person.slug, person])).values()];
  const authorNote = uniquePeople.length
    ? `<aside class="author-note" aria-label="${escapeHtml(en ? "About the contributors" : "Über die Beteiligten")}">${uniquePeople.map((person) => `<p><strong><a href="${routeForAuthor(site, locale, person.slug)}">${escapeHtml(person.name)}</a></strong> · ${escapeHtml(personRoleLabels(person, locale).join(", "))}${person.bio ? ` · <span lang="de">${escapeHtml(sentenceSummaryFromText(person.bio, 1, 200))}</span>` : ""}</p>`).join("")}</aside>`
    : "";
  const actionBar = `<div class="action-bar">
            ${topScans ? `<a href="#original-pages">${escapeHtml(en ? "View original page" : "Originalseite ansehen")}</a>` : ""}
            <a href="${routeForArticle(site, locale, localized.slug)}index.md" type="text/markdown">Markdown</a>
            ${locales.map((entry) => {
              if (articleLocaleState(localized, entry) === "missing") return "";
              const current = entry === locale ? ' aria-current="page"' : "";
              return `<a href="${routeForArticle(site, entry, localized.slug)}" hreflang="${entry}" lang="${entry}"${current}>${escapeHtml(entry === "de" ? "Deutsch" : "English")}</a>`;
            }).join("")}
          </div>`;
  const body = `
    <article>
    <section class="hero">
      <div class="article-hero-inner">
        <div class="hero-copy">
          <p class="kicker"><span class="kicker-tag">${escapeHtml(issueTitle)}${issueDate ? ` · ${escapeHtml(issueDateLabel(issueDate, locale))}` : ""}</span>${rubric ? `<span class="kicker-rubric">${escapeHtml(rubric)}</span>` : ""}</p>
          <h1 class="news-headline">${escapeHtml(localized.title)}</h1>
          ${deck ? `<p class="deck">${renderInlineMarkdown(deck)}</p>` : ""}
          <div class="byline-block">
            ${bylineHtml}
            ${secondaryHtml}
            ${datelineHtml}
          </div>
          ${authorNote}
          ${actionBar}
          ${translationNote}
        </div>${articleHeroFigure}
      </div>
    </section>
    ${topScans}
    <section class="article-shell no-support">
      <div class="article-main">
        <section class="panel">
          <div class="content">
            ${stripDeckEcho(renderMarkdownToHtml(articleBody), deck)}
          </div>
        </section>
        ${renderAuthorBox(site, locale, uniquePeople, localized.slug)}
        ${videosSection}
        ${relatedArchiveSection}
      </div>
      ${sourcePanel}
    </section>
    </article>`;

  return renderLayout(site, {
    locale,
    title: `${localized.title} | ${site.siteTitle}`,
    description: articleSummary || siteDescription(site, locale),
    route: routeForArticle(site, locale, localized.slug),
    markdownRoute: `${routeForArticle(site, locale, localized.slug)}index.md`,
    body,
    bodyClass: "article-page",
    alternates: articleAlternateEntries(site, localized, locales),
    canonicalRoute: articleCanonicalRoute(site, localized),
    socialImage: previewHref,
    socialType: "article",
    socialTitle: `${localized.title} | ${site.siteTitle}`,
    socialDescription: articleSummary || siteDescription(site, locale),
    issueDate,
    navCurrent: "articles",
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [{
      "@type": "Article",
      headline: localized.title,
      inLanguage: articleContentLocale(localized),
      description: deck || articleSummary || siteDescription(site, locale),
      ...(issueDate ? { datePublished: issueDate } : {}),
      ...(CONTENT_MODIFIED_AT ? { dateModified: CONTENT_MODIFIED_AT } : {}),
      ...(byline.authors.length ? { author: byline.authors.map((entry) => personJsonLd(site, entry.slug ? PEOPLE_BY_SLUG.get(entry.slug).name : entry.name, entry.slug)) } : {}),
      ...(byline.secondary.some((entry) => entry.slug) ? { contributor: byline.secondary.filter((entry) => entry.slug).map((entry) => personJsonLd(site, PEOPLE_BY_SLUG.get(entry.slug).name, entry.slug)) } : {}),
      publisher: publisherJsonLd(site),
      isPartOf: {
        "@type": "PublicationIssue",
        name: issueTitle,
        url: `${baseUrl(site)}${routeForMagazine(site, locale, localized.magazineSlug)}`,
        ...(issueNumberFromSeed(localized.magazineTitle) ? { issueNumber: issueNumberFromSeed(localized.magazineTitle) } : {}),
        ...(issueDate ? { datePublished: issueDate } : {}),
        isPartOf: periodicalJsonLd(site),
      },
      pagination: pageRangeLabel(localized),
      url: `${baseUrl(site)}${articleCanonicalRoute(site, localized)}`,
      mainEntityOfPage: `${baseUrl(site)}${articleCanonicalRoute(site, localized)}`,
      image: previewHref ? `${baseUrl(site)}${previewHref}` : undefined,
      },
      breadcrumbJsonLd(site, [
        { name: "proud", route: homeRoute(site, locale) },
        { name: issueTitle, route: routeForMagazine(site, locale, localized.magazineSlug) },
        { name: localized.title, route: routeForArticle(site, locale, localized.slug) },
      ])],
    },
  });
}

// Rubric printed above the article (from ingest tags). The masthead page's tags are role names, not a rubric.
function articleRubric(article) {
  const tag = (article.tags ?? [])[0];
  if (!tag || (article.tags ?? []).length > 2) return "";
  return String(tag).trim();
}

// The deck is often the printed sub-headline, which is also the first body paragraph. Show it once.
function stripDeckEcho(html, deck) {
  if (!deck) return html;
  const match = html.match(/^\s*<p>([\s\S]*?)<\/p>\s*/);
  if (!match) return html;
  const first = normalizeForCompare(match[1].replace(/<[^>]+>/g, ""));
  return first && first === normalizeForCompare(deck) ? html.slice(match[0].length) : html;
}

// One-sentence deck from the existing summary text.
function articleDeck(article, locale) {
  const summary = visibleSummaryForArticle(article, locale);
  let deck = sentenceSummaryFromText(summary, 1, 260) || "";
  if ((deck.match(/„/g) ?? []).length > (deck.match(/“/g) ?? []).length) deck += "“";
  return deck;
}

function renderAuthorBox(site, locale, people, currentSlug) {
  if (!people.length) return "";
  const en = isEnglishLocale(locale);
  return `
        <section class="author-box" aria-labelledby="author-box-title">
          <h2 class="section-label" id="author-box-title">${escapeHtml(en ? (people.length > 1 ? "About the contributors" : "About the contributor") : (people.length > 1 ? "Über die Beteiligten" : "Über die Person"))}</h2>
          ${people.map((person) => {
            const others = person.credits.filter((credit) => credit.articleSlug !== currentSlug).map((credit) => ARTICLES_BY_SLUG.get(credit.articleSlug)).filter(Boolean);
            return `<div class="author-box-entry">
            <h3><a href="${routeForAuthor(site, locale, person.slug)}">${escapeHtml(person.name)}</a></h3>
            <p class="meta">${escapeHtml(personRoleLabels(person, locale).join(", "))} · ${escapeHtml(en ? "Contributor to proud #01" : "Mitarbeit an proud #01")}</p>
            ${person.bio ? `<p>${escapeHtml(person.bio)} <span class="meta">(${escapeHtml(en ? `printed bio, proud #01, page ${person.bioSource.page}, German original` : `gedruckte Kurzbio, proud #01, Seite ${person.bioSource.page}`)})</span></p>` : ""}
            ${others.length ? `<p class="meta">${escapeHtml(en ? "Also in the archive:" : "Außerdem im Archiv:")} ${others.map((article) => `<a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a>`).join(", ")}</p>` : ""}
          </div>`;
          }).join("")}
        </section>`;
}

function buildMagazineMarkdown(site, locale, magazine, localizedArticles) {
  const copy = ui(locale);
  const orderedArticles = sortArticlesForIssue(localizedArticles);
  const issueTitle = displayMagazineTitle(magazine, locale);
  const lines = [
    frontmatter({
      title: issueTitle,
      slug: magazine.slug,
      locale,
      publication_date: magazine.publicationDate,
      source_pdf: magazine.sourcePdf,
      page_count: magazine.pageCount,
      article_count: magazine.articleCount,
      canonical_url: `${baseUrl(site)}${routeForMagazine(site, locale, magazine.slug)}`,
    }),
    `# ${issueTitle}`,
    "",
    `> ${copy.source}: ${magazine.sourcePdf}`,
    `> ${copy.pages}: ${magazine.pageCount}`,
    "",
    `## ${copy.articles}`,
    "",
    ...orderedArticles.map(
      (article) =>
        `- [${article.title}](${baseUrl(site)}${routeForArticle(site, locale, article.slug)}index.md): ${article.pages.start === article.pages.end ? copy.pageSingularLower : copy.pageLower} ${pageRangeLabel(article)}, ${formatCount(article.wordCount, locale)} ${copy.words}. ${displaySummaryForArticle(article, locale)}`,
    ),
    "",
  ];

  return lines.join("\n");
}

function buildMagazineHtml(site, locale, magazine, localizedArticles, locales) {
  const copy = ui(locale);
  const orderedArticles = sortArticlesForIssue(localizedArticles);
  const issueTitle = displayMagazineTitle(magazine, locale);
  const issueDescription = isEnglishLocale(locale)
    ? `${issueTitle} from the proud archive with ${magazine.articleCount} stories and ${magazine.pageCount} pages.`
    : `${issueTitle} aus dem proud-Archiv mit ${magazine.articleCount} Geschichten und ${magazine.pageCount} Seiten.`;
  const metaChips = [
    `<span class="stat-chip"><strong>${formatCount(magazine.pageCount, locale)}</strong> ${escapeHtml(copy.pages)}</span>`,
    `<span class="stat-chip"><strong>${formatCount(magazine.articleCount, locale)}</strong> ${escapeHtml(copy.articles)}</span>`,
  ];
  const issueDate = issueDateFor(magazine.slug);
  if (issueDate) {
    metaChips.push(`<span class="stat-chip"><strong>${renderIssueTime(issueDate, locale)}</strong> ${escapeHtml(copy.date)}</span>`);
  }
  const shareImage = articleCoverHref(orderedArticles[0]) ?? null;
  const body = `
    <section class="hero">
      <div class="hero-grid">
        <div class="hero-copy">
          <p class="kicker"><span class="kicker-tag">proud magazine Berlin</span></p>
          <h1 class="news-headline">${escapeHtml(issueTitle)}</h1>
          <p class="lede">${escapeHtml(copy.issueIntro)}</p>
          <div class="stat-row">${metaChips.join("")}</div>
          <div class="locale-nav compact-locale-nav">
            ${renderAlternates(site, magazine, routeForMagazine, locales)
              .map((entry) => `<a class="${entry.locale === locale ? "locale-chip current" : "locale-chip"}" href="${entry.route}">${escapeHtml(localeLabelForUi(entry.locale, locale))}</a>`)
              .join("")}
          </div>
          <div class="action-row" style="margin-top:0.8rem">
            ${renderActionButton(`/assets/pdfs/${encodeURIComponent(magazine.sourcePdf)}`, copy.originalPdf, "primary")}
            ${renderActionButton(magazineMarkdownRoute(site, locale, magazine), copy.issueMarkdown)}
          </div>
        </div>
      </div>
    </section>
    <section class="section-stack">
      <section class="panel list-panel">
        <div class="section-rule"></div>
        <h2 class="section-label">${escapeHtml(copy.issueContents)}</h2>
        <ol class="article-list" style="margin-top:1rem">
          ${orderedArticles.map((article) => renderArticleReviewCard(site, locale, article)).join("")}
        </ol>
      </section>
    </section>`;

  return renderLayout(site, {
    locale,
    title: `${issueTitle} | ${site.siteTitle}`,
    description: issueDescription,
    route: routeForMagazine(site, locale, magazine.slug),
    markdownRoute: `${routeForMagazine(site, locale, magazine.slug)}index.md`,
    body,
    alternates: renderAlternates(site, magazine, routeForMagazine, locales),
    navCurrent: "issues",
    socialImage: shareImage,
    socialTitle: `${issueTitle} | ${site.siteTitle}`,
    socialDescription: issueDescription,
    issueDate,
    structuredData: {
      "@context": "https://schema.org",
      "@type": "PublicationIssue",
      name: issueTitle,
      url: `${baseUrl(site)}${routeForMagazine(site, locale, magazine.slug)}`,
      inLanguage: site.defaultLocale,
      ...(issueNumberFromSeed(magazine.title) ? { issueNumber: issueNumberFromSeed(magazine.title) } : {}),
      ...(issueDate ? { datePublished: issueDate } : {}),
      numberOfPages: magazine.pageCount,
      isPartOf: periodicalJsonLd(site),
      publisher: publisherJsonLd(site),
    },
  });
}

function buildIndexMarkdown(site, locale, articles, magazines) {
  const copy = ui(locale);
  const lines = [
    frontmatter({
      title: site.siteTitle,
      locale,
      canonical_url: `${baseUrl(site)}${homeRoute(site, locale)}`,
      llms: `${baseUrl(site)}${routeForLlms(site, locale)}`,
    }),
    `# ${site.siteTitle}`,
    "",
    `> ${siteDescription(site, locale)}`,
    "",
    `## ${copy.archiveStats}`,
    `- ${copy.magazinesNav}: ${magazines.length}`,
    `- ${copy.articlesNav}: ${articles.length}`,
    "",
    `## ${copy.recentArticles}`,
    "",
    ...articles.slice(0, 20).map(
      (article) =>
        `- [${article.title}](${baseUrl(site)}${routeForArticle(site, locale, article.slug)}index.md): ${displaySummaryForArticle(article, locale)}`,
    ),
    "",
    `## ${copy.magazineIndex}`,
    "",
    ...magazines.map(
      (magazine) =>
        `- [${magazine.title}](${baseUrl(site)}${routeForMagazine(site, locale, magazine.slug)}index.md): ${magazine.articleCount} ${copy.articles}`,
    ),
    "",
  ];

  return lines.join("\n");
}

function renderStoryKicker(site, locale, article, { link = false } = {}) {
  const issueTitle = displayMagazineTitle(article, locale);
  const rubric = articleRubric(article);
  void link;
  const tag = `<span class="kicker-tag">${escapeHtml(issueTitle)}</span>`;
  return `<p class="kicker">${tag}${rubric ? `<span class="kicker-rubric">${escapeHtml(rubric)}</span>` : ""}</p>`;
}

function renderStoryByline(site, locale, article) {
  const en = isEnglishLocale(locale);
  const byline = bylineFor(EDITORIAL, article, PEOPLE_BY_SLUG, locale);
  const issueDate = issueDateFor(article.magazineSlug);
  const parts = [];
  if (byline.authors.length) parts.push(`${en ? "By" : "Von"} ${byline.authors.map((entry) => entry.name).join(", ")}`);
  else if (byline.secondary.some((entry) => entry.role === "photo" && entry.slug)) parts.push(byline.secondary.filter((entry) => entry.role === "photo" && entry.slug).map((entry) => `${entry.label}: ${entry.name}`).join(" · "));
  return `<p class="dateline">${parts.length ? `<span class="byline">${escapeHtml(parts.join(" · "))}</span> · ` : ""}${issueDate ? renderIssueTime(issueDate, locale) : ""}</p>`;
}

// Issue cover thumbnail: only when a real cover asset exists (none are published yet, so the strip shows text).
function issueCoverHref(magazine) {
  return magazine?.coverImage ? `/assets/${optimizedImagePath(magazine.coverImage)}` : null;
}

// Home lead: the longest article that has both a printed text credit and a hero cutout; fall back to longest with hero.
function pickLeadArticle(articles) {
  const ranked = sortArticlesByWordCount(articles);
  return ranked.find((article) => heroHref(article) && bylineFor(EDITORIAL, article, PEOPLE_BY_SLUG, "de").authors.filter((entry) => entry.slug).length === 1)
    ?? ranked.find((article) => heroHref(article))
    ?? ranked[0];
}

function buildIndexHtml(site, locale, articles, magazines, locales) {
  const copy = ui(locale);
  const en = isEnglishLocale(locale);
  const leadArticle = pickLeadArticle(articles);
  const gridArticles = sortArticlesByWordCount(articles)
    .filter((article) => article.slug !== leadArticle?.slug && heroHref(article) && visibleSummaryForArticle(article, locale))
    .slice(0, 9);
  const leadHref = leadArticle ? routeForArticle(site, locale, leadArticle.slug) : null;
  const leadImage = leadArticle ? articleCoverHref(leadArticle) : null;
  const issueCovers = magazines
    .map((magazine) => ({ magazine, cover: issueCoverHref(magazine) }))
    .filter((entry) => entry.cover);
  void issueCovers;
  const body = `
    <h1 class="visually-hidden">proud magazine Berlin: ${escapeHtml(en ? "archive edition" : "Archiv-Ausgabe")}</h1>
    ${leadArticle ? `
    <article class="home-lead">
      <div>
        ${renderStoryKicker(site, locale, leadArticle, { link: true })}
        <h2 class="news-headline"><a href="${leadHref}">${escapeHtml(leadArticle.title)}</a></h2>
        <p class="deck">${renderInlineMarkdown(articleDeck(leadArticle, locale))}</p>
        <div class="byline-block">${renderStoryByline(site, locale, leadArticle).replace('<p class="dateline">', `<p class="dateline">Berlin · `)}</div>
      </div>
      ${leadImage ? `<figure><a href="${leadHref}" tabindex="-1" aria-hidden="true">${imgTag(leadImage, "", { priority: true })}</a><figcaption>${escapeHtml(copy.heroCutoutCaption)}, ${escapeHtml(displayMagazineTitle(leadArticle, locale))}, ${escapeHtml(pagesLabel(copy, leadArticle))}</figcaption></figure>` : ""}
    </article>` : ""}
    <ul class="story-grid">
      ${gridArticles.map((article) => {
        const href = routeForArticle(site, locale, article.slug);
        return `<li>
        <a href="${href}" tabindex="-1" aria-hidden="true">${imgTag(articleCoverHref(article), "")}</a>
        ${renderStoryKicker(site, locale, article)}
        <h3 class="news-headline"><a href="${href}">${escapeHtml(article.title)}</a></h3>
        <p class="deck">${renderInlineMarkdown(articleDeck(article, locale))}</p>
        ${renderStoryByline(site, locale, article)}
      </li>`;
      }).join("")}
    </ul>
    <div class="section-head"><h2 class="section-label">${escapeHtml(en ? "Issues" : "Ausgaben")}</h2><a href="${routeForArticlesIndex(site, locale)}">${escapeHtml(en ? "All articles" : "Alle Artikel")}</a></div>
    <ul class="issue-strip">
      ${magazines.map((magazine) => {
        const cover = issueCoverHref(magazine);
        const issueDate = issueDateFor(magazine.slug);
        return `<li><a href="${routeForMagazine(site, locale, magazine.slug)}">${cover ? imgTag(cover, "") : ""}<strong>${escapeHtml(displayMagazineTitle(magazine, locale))}</strong><span>${issueDate ? renderIssueTime(issueDate, locale) : ""} · ${formatCount(magazine.articleCount, locale)} ${escapeHtml(copy.articles)}</span></a></li>`;
      }).join("")}
    </ul>`;

  return renderLayout(site, {
    locale,
    title: `${site.siteTitle} | ${isEnglishLocale(locale) ? "Front Page" : "Titelseite"}`,
    description: siteDescription(site, locale),
    route: homeRoute(site, locale),
    markdownRoute: locale === site.defaultLocale ? "/index.md" : `${routePrefix(site, locale)}/index.md`,
    body,
    alternates: locales.map((entry) => ({ locale: entry, route: homeRoute(site, entry) })),
    socialImage: articleCoverHref(leadArticle) ?? null,
    socialTitle: `${site.siteTitle} | ${isEnglishLocale(locale) ? "Front Page" : "Titelseite"}`,
    socialDescription: siteDescription(site, locale),
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          ...organizationFullJsonLd(site, locale),
          description: siteDescription(site, locale),
          knowsAbout: ["Music", "Berlin", "City life", "Nightlife", "Style"],
        },
        periodicalJsonLd(site),
        ...magazines.map((magazine) => ({
          "@type": "PublicationIssue",
          name: displayMagazineTitle(magazine, locale),
          url: `${baseUrl(site)}${routeForMagazine(site, locale, magazine.slug)}`,
          ...(issueNumberFromSeed(magazine.title) ? { issueNumber: issueNumberFromSeed(magazine.title) } : {}),
          ...(issueDateFor(magazine.slug) ? { datePublished: issueDateFor(magazine.slug) } : {}),
          isPartOf: { "@id": `${baseUrl(site)}/#periodical` },
        })),
        {
          "@type": "WebSite",
          "@id": `${baseUrl(site)}/#website`,
          name: site.siteTitle,
          url: `${baseUrl(site)}${homeRoute(site, locale)}`,
          description: siteDescription(site, locale),
          inLanguage: locale,
          publisher: currentPublisherJsonLd(site),
        },
      ],
    },
  });
}

function buildListPageMarkdown(site, locale, title, route, items, type) {
  const lines = [
    frontmatter({
      title,
      locale,
      canonical_url: `${baseUrl(site)}${route}`,
      type,
    }),
    `# ${title}`,
    "",
    ...items,
    "",
  ];

  return lines.join("\n");
}

function buildListPageHtml(site, locale, title, route, markdownRoute, itemsHtml, description = title, socialImage = null, navCurrent = null, locales = [site.defaultLocale]) {
  const copy = ui(locale);
  return renderLayout(site, {
    locale,
    title: `${title} | ${site.siteTitle}`,
    description,
    route,
    markdownRoute,
    body: `
      <section class="hero">
        <h1 class="news-headline">${escapeHtml(title)}</h1>
        <p class="lede">${escapeHtml(copy.listPageIntro)}</p>
      </section>
      <section class="panel list-panel" style="margin-top:1rem">
        ${itemsHtml}
      </section>`,
    socialImage,
    socialTitle: `${title} | ${site.siteTitle}`,
    socialDescription: description,
    navCurrent,
    alternates: locales.map((entry) => ({ locale: entry, route: route.replace(/^\/en\//, "/").replace(/^\//, entry === site.defaultLocale ? "/" : `/${entry}/`) })),
  });
}

function staticRoutes(site, locale) {
  return {
    about: routeForStatic(site, locale, "about"),
    masthead: routeForStatic(site, locale, "masthead"),
    standards: routeForStatic(site, locale, "standards"),
    press: routeForStatic(site, locale, "press"),
    corrections: routeForStatic(site, locale, "corrections"),
    authors: routeForStatic(site, locale, "authors"),
    articles: routeForArticlesIndex(site, locale),
    issues: routeForMagazinesIndex(site, locale),
    author: (slug) => routeForAuthor(site, locale, slug),
  };
}

// Generic text page (About, Masthead, Standards, Press, Corrections, Archive guide, Impressum, Datenschutz).
function buildStaticPage(site, locale, key, locales, context) {
  const title = staticPageTitle(key, locale);
  const description = staticPageDescription(key, locale);
  const markdownBody = staticPageMarkdown(key, locale, { editorial: EDITORIAL, site, routes: staticRoutes(site, locale), ...context });
  const route = routeForStatic(site, locale, key);
  const en = isEnglishLocale(locale);
  const pageTypes = { about: "AboutPage", masthead: "AboutPage", press: "AboutPage", impressum: "AboutPage", datenschutz: "WebPage" };
  const html = renderLayout(site, {
    locale,
    title: `${title} | proud magazine Berlin`,
    description,
    route,
    markdownRoute: `${route}index.md`,
    navCurrent: ["about", "masthead"].includes(key) ? key : null,
    alternates: locales.map((entry) => ({ locale: entry, route: routeForStatic(site, entry, key) })),
    body: `
    <section class="page-head">
      <p class="kicker"><span class="kicker-tag">proud magazine Berlin</span><span class="kicker-rubric">${escapeHtml(en ? "Archive edition" : "Archiv-Ausgabe")}</span></p>
      <h1 class="news-headline">${escapeHtml(title)}</h1>
      <p class="deck">${escapeHtml(description)}</p>
    </section>
    <div class="prose">
      ${renderMarkdownToHtml(staticPageMarkdownWithMarker(key, locale, { editorial: EDITORIAL, site, routes: staticRoutes(site, locale), ...context })).replace(/<p>@@DFJV_QUOTE@@<\/p>/, dfjvMentionHtml(locale))}
    </div>`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": pageTypes[key] ?? "WebPage",
          name: title,
          description,
          url: `${baseUrl(site)}${route}`,
          inLanguage: locale,
          isPartOf: { "@type": "WebSite", "@id": `${baseUrl(site)}/#website` },
          about: { "@id": `${baseUrl(site)}/#organization` },
        },
        breadcrumbJsonLd(site, [{ name: "proud", route: homeRoute(site, locale) }, { name: title, route }]),
      ],
    },
  });
  const markdown = `${frontmatter({ title, locale, canonical_url: `${baseUrl(site)}${route}`, type: `page-${key}` })}# ${title}\n\n> ${description}\n\n${markdownBody}\n`;
  return { route, html, markdown };
}

function authorArticleItems(site, locale, person) {
  const seen = new Set();
  return person.credits
    .filter((credit) => !seen.has(credit.articleSlug) && seen.add(credit.articleSlug))
    .map((credit) => ({ credit, article: ARTICLES_BY_SLUG.get(credit.articleSlug) }))
    .filter((entry) => entry.article);
}

function buildAuthorPage(site, locale, person, locales) {
  const en = isEnglishLocale(locale);
  const route = routeForAuthor(site, locale, person.slug);
  const roles = personRoleLabels(person, locale);
  const items = authorArticleItems(site, locale, person);
  const description = en
    ? `${person.name}: ${roles.join(", ")} in proud magazine Berlin, issue 01 (January 2009). Credits as printed.`
    : `${person.name}: ${roles.join(", ")} bei proud magazine Berlin, Heft 01 (Januar 2009). Credits wie gedruckt.`;
  const printedAsNote = person.printedAs.length
    ? (en ? `Printed in an article credit as “${person.printedAs.join("”, “")}”; the masthead spells “${person.name}”.` : `In einem Artikel-Credit gedruckt als „${person.printedAs.join("“, „")}“; das Impressum schreibt „${person.name}“.`)
    : "";
  const mastheadLines = person.mastheadRoles.map((role) => `${en ? role.en : role.de} (${en ? "masthead" : "Impressum"} proud #01, ${en ? "page" : "Seite"} ${role.page})`);
  const currentNote = person.slug === "emin-henri-mahrt"
    ? (en ? `Publisher today: ${CURRENT_PUBLISHER} (owner statement, October 2026). The roles below are those printed in issue 01 (2009).` : `Herausgeber heute: ${CURRENT_PUBLISHER} (Angabe des Herausgebers, Oktober 2026). Die Rollen unten sind die in Heft 01 (2009) gedruckten.`)
    : "";
  const markdownLines = [
    ...(currentNote ? [currentNote] : []),
    `**${en ? "Roles" : "Rollen"}:** ${roles.join(", ")}`,
    `${en ? "Contributor to proud #01" : "Mitarbeit an proud #01"} (${en ? "January 2009" : "Januar 2009"}).`,
    ...(person.bio ? [`## ${en ? "Printed bio" : "Gedruckte Kurzbio"}`, `> ${person.bio}`, en ? `(proud #01, page ${person.bioSource.page}, German original)` : `(proud #01, Seite ${person.bioSource.page})`] : []),
    ...(mastheadLines.length ? [`## ${en ? "Masthead" : "Impressum"}`, mastheadLines.map((line) => `- ${line}`).join("\n")] : []),
    ...(items.length ? [`## ${en ? "Articles" : "Artikel"}`, items.map(({ credit, article }) => `- [${article.title}](${routeForArticle(site, locale, article.slug)}): ${credit.printedLabel} ${credit.printedName}, ${displayMagazineTitle(article, locale)}, ${pagesLabel(ui(locale), article)}`).join("\n")] : []),
    ...(printedAsNote ? [printedAsNote] : []),
    en ? "Source: printed credits in the scanned issue. No further biography is known to this archive." : "Quelle: gedruckte Credits im gescannten Heft. Weitere biografische Angaben liegen dem Archiv nicht vor.",
  ];
  const markdownBody = markdownLines.join("\n\n");
  const html = renderLayout(site, {
    locale,
    title: `${person.name} | proud magazine Berlin`,
    description,
    route,
    markdownRoute: `${route}index.md`,
    navCurrent: "authors",
    alternates: locales.map((entry) => ({ locale: entry, route: routeForAuthor(site, entry, person.slug) })),
    body: `
    <section class="page-head">
      <p class="kicker"><span class="kicker-tag">${escapeHtml(en ? "Authors" : "Autor:innen")}</span><span class="kicker-rubric">proud #01</span></p>
      <h1 class="news-headline">${escapeHtml(person.name)}</h1>
      <p class="deck">${escapeHtml(roles.join(", "))} · ${escapeHtml(en ? "Contributor to proud #01" : "Mitarbeit an proud #01")}</p>
    </section>
    <div class="prose">
      ${currentNote ? `<p>${escapeHtml(currentNote)}</p>` : ""}
      ${person.bio ? `<h2>${escapeHtml(en ? "Printed bio" : "Gedruckte Kurzbio")}</h2><blockquote lang="de">${escapeHtml(person.bio)}</blockquote><p class="meta">${escapeHtml(en ? `proud #01, page ${person.bioSource.page}, German original` : `proud #01, Seite ${person.bioSource.page}`)}</p>` : ""}
      ${mastheadLines.length ? `<h2>${escapeHtml(en ? "Masthead" : "Impressum")}</h2><ul>${mastheadLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>` : ""}
      ${items.length ? `<h2>${escapeHtml(en ? "Articles" : "Artikel")}</h2>
      <ul class="plain-list">${items.map(({ credit, article }) => `<li><a href="${routeForArticle(site, locale, article.slug)}">${escapeHtml(article.title)}</a><span class="meta">${escapeHtml(`${credit.printedLabel} ${credit.printedName}`)} · ${escapeHtml(displayMagazineTitle(article, locale))} · ${escapeHtml(pagesLabel(ui(locale), article))}</span></li>`).join("")}</ul>` : ""}
      ${printedAsNote ? `<p class="meta">${escapeHtml(printedAsNote)}</p>` : ""}
      <p class="meta">${escapeHtml(en ? "Source: printed credits in the scanned issue. No further biography is known to this archive." : "Quelle: gedruckte Credits im gescannten Heft. Weitere biografische Angaben liegen dem Archiv nicht vor.")}</p>
    </div>`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "ProfilePage",
          url: `${baseUrl(site)}${route}`,
          inLanguage: locale,
          mainEntity: {
            "@type": "Person",
            "@id": `${baseUrl(site)}/authors/${person.slug}/#person`,
            name: person.name,
            ...(person.printedAs.length ? { alternateName: person.printedAs } : {}),
            ...(person.mastheadRoles.some((role) => ["publisher", "textEditor", "fashionEditor", "eventManager", "advertisingManager", "production"].includes(role.key)) ? { worksFor: { "@id": `${baseUrl(site)}/#organization` } } : {}),
            ...(person.mastheadRoles.length ? { jobTitle: [...new Set(person.mastheadRoles.map((role) => role.en))].join(", ") } : {}),
            ...(person.bio ? { description: person.bio } : {}),
          },
          ...(items.length ? { hasPart: items.map(({ article }) => ({ "@type": "Article", headline: article.title, url: `${baseUrl(site)}${routeForArticle(site, locale, article.slug)}` })) } : {}),
        },
        breadcrumbJsonLd(site, [
          { name: "proud", route: homeRoute(site, locale) },
          { name: en ? "Authors" : "Autor:innen", route: routeForStatic(site, locale, "authors") },
          { name: person.name, route },
        ]),
      ],
    },
  });
  const markdown = `${frontmatter({ title: person.name, locale, canonical_url: `${baseUrl(site)}${route}`, type: "author", roles })}# ${person.name}\n\n${markdownBody}\n`;
  return { route, html, markdown };
}

function buildAuthorsIndex(site, locale, locales) {
  const en = isEnglishLocale(locale);
  const route = routeForStatic(site, locale, "authors");
  const title = staticPageTitle("authors", locale);
  const description = staticPageDescription("authors", locale);
  const note = en
    ? "Everyone named here is credited in print: in an article credit or in the masthead of issue 01. Names as printed. Image agencies and websites credited as photo sources are not listed as people."
    : "Alle hier genannten Personen haben einen gedruckten Credit: an einem Artikel oder im Impressum von Heft 01. Namen wie gedruckt. Bildagenturen und Websites als Bildquelle sind nicht als Personen gelistet.";
  const html = renderLayout(site, {
    locale,
    title: `${title} | proud magazine Berlin`,
    description,
    route,
    markdownRoute: `${route}index.md`,
    navCurrent: "authors",
    alternates: locales.map((entry) => ({ locale: entry, route: routeForStatic(site, entry, "authors") })),
    body: `
    <section class="page-head">
      <p class="kicker"><span class="kicker-tag">proud magazine Berlin</span></p>
      <h1 class="news-headline">${escapeHtml(title)}</h1>
      <p class="deck">${escapeHtml(description)}</p>
    </section>
    <p class="prose">${escapeHtml(note)} <a href="${routeForStatic(site, locale, "masthead")}">${escapeHtml(en ? "Full masthead" : "Vollständiges Impressum")}</a></p>
    <ul class="people-list">
      ${PEOPLE.map((person) => `<li><a href="${routeForAuthor(site, locale, person.slug)}">${escapeHtml(person.name)}</a><span>${escapeHtml(personRoleLabels(person, locale).join(", "))}${person.credits.length ? ` · ${person.credits.length} ${escapeHtml(en ? (person.credits.length === 1 ? "article" : "articles") : (person.credits.length === 1 ? "Artikel" : "Artikel"))}` : ""}</span></li>`).join("\n      ")}
    </ul>`,
    structuredData: {
      "@context": "https://schema.org",
      "@graph": [
        {
          "@type": "CollectionPage",
          name: title,
          url: `${baseUrl(site)}${route}`,
          inLanguage: locale,
          mainEntity: { "@type": "ItemList", itemListElement: PEOPLE.map((person, index) => ({ "@type": "ListItem", position: index + 1, url: `${baseUrl(site)}${routeForAuthor(site, locale, person.slug)}`, name: person.name })) },
        },
        breadcrumbJsonLd(site, [{ name: "proud", route: homeRoute(site, locale) }, { name: title, route }]),
      ],
    },
  });
  const markdown = `${frontmatter({ title, locale, canonical_url: `${baseUrl(site)}${route}`, type: "authors-index" })}# ${title}\n\n> ${description}\n\n${note}\n\n${PEOPLE.map((person) => `- [${person.name}](${baseUrl(site)}${routeForAuthor(site, locale, person.slug)}index.md): ${personRoleLabels(person, locale).join(", ")}`).join("\n")}\n`;
  return { route, html, markdown };
}

function digestForText(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

function buildRobots(site) {
  const signals = site.contentSignals ?? {};
  const aiCrawlerRules = AI_CRAWLER_RULES.map((userAgent) => `User-agent: ${userAgent}
Allow: /`).join("\n\n");
  return `# proud allows search, retrieval, and citation by people, search engines, and AI agents.
User-agent: *
Allow: /
Content-Signal: ai-train=${signals.aiTrain === false ? "no" : "yes"}, ai-input=${signals.aiInput === false ? "no" : "yes"}, search=${signals.search === false ? "no" : "yes"}

${aiCrawlerRules}

Sitemap: ${baseUrl(site)}/sitemap.xml
`;
}

function buildOpenApi(site) {
  const json = (schemaRef) => ({ "application/json": { schema: { $ref: schemaRef } } });
  const problem = { description: "Error (RFC 9457 problem details)", content: { "application/problem+json": { schema: { $ref: "#/components/schemas/Problem" } } } };
  const slugParam = { name: "slug", in: "path", required: true, schema: { type: "string", pattern: "^[a-z0-9-]+$" } };
  return {
    openapi: "3.1.0",
    info: {
      title: "proud archive read API",
      version: "0.2.0",
      description: "Read-only JSON and search API for the proud.de magazine archive. No authentication. Errors use RFC 9457 problem details.",
    },
    servers: [{ url: baseUrl(site) }],
    paths: {
      "/api/library.json": {
        get: { operationId: "getLibrary", summary: "Get archive library index", responses: { 200: { description: "OK", content: json("#/components/schemas/Library") }, default: problem } },
      },
      "/api/articles.json": {
        get: { operationId: "listArticles", summary: "List articles", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ArticleSummary" } } } } }, default: problem } },
      },
      "/api/magazines.json": {
        get: { operationId: "listMagazines", summary: "List magazines", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/MagazineSummary" } } } } }, default: problem } },
      },
      "/api/authors.json": {
        get: { operationId: "listAuthors", summary: "List people credited in print (name as printed, roles, article credits)", responses: { 200: { description: "OK", content: { "application/json": { schema: { type: "array", items: { type: "object" } } } } }, default: problem } },
      },
      "/api/articles/{slug}.json": {
        get: {
          operationId: "getArticle",
          summary: "Get article by slug",
          parameters: [slugParam],
          responses: { 200: { description: "OK", content: json("#/components/schemas/Article") }, 404: problem, default: problem },
        },
      },
      "/api/magazines/{slug}.json": {
        get: {
          operationId: "getMagazine",
          summary: "Get magazine by slug",
          parameters: [slugParam],
          responses: { 200: { description: "OK", content: json("#/components/schemas/Magazine") }, 404: problem, default: problem },
        },
      },
      "/api/search": {
        get: {
          operationId: "searchArticles",
          summary: "Search article full text",
          parameters: [
            { name: "q", in: "query", required: true, schema: { type: "string" } },
            { name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 50, default: 10 } },
          ],
          responses: { 200: { description: "OK", content: json("#/components/schemas/SearchResponse") }, 405: problem, default: problem },
        },
      },
      "/mcp": {
        post: {
          operationId: "mcpRequest",
          summary: "Streamable HTTP MCP endpoint (JSON-RPC 2.0)",
          requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/JsonRpcMessage" } } } },
          responses: { 200: { description: "MCP JSON-RPC response", content: json("#/components/schemas/JsonRpcMessage") }, default: problem },
        },
      },
    },
    components: {
      schemas: {
        Problem: {
          type: "object",
          description: "RFC 9457 problem details.",
          required: ["title", "status"],
          properties: {
            type: { type: "string", default: "about:blank" },
            title: { type: "string" },
            status: { type: "integer" },
            detail: { type: "string" },
            instance: { type: "string" },
          },
        },
        PageSpan: { type: "object", required: ["start", "end"], properties: { start: { type: "integer" }, end: { type: "integer" } } },
        ArticleSummary: {
          type: "object",
          required: ["slug", "title", "magazineSlug", "pages", "url"],
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            magazineSlug: { type: "string" },
            magazineTitle: { type: "string" },
            magazineDisplayTitle: { type: "string" },
            summary: { type: ["string", "null"] },
            excerpt: { type: ["string", "null"] },
            pages: { $ref: "#/components/schemas/PageSpan" },
            sourcePdf: { type: "string" },
            previewImage: { type: ["string", "null"], format: "uri" },
            heroImage: { type: ["string", "null"], format: "uri" },
            pageImageCount: { type: "integer" },
            url: { type: "string", format: "uri" },
          },
        },
        Article: {
          type: "object",
          required: ["slug", "title", "magazineSlug", "pages"],
          additionalProperties: true,
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            magazineSlug: { type: "string" },
            magazineTitle: { type: "string" },
            pages: { $ref: "#/components/schemas/PageSpan" },
            summary: { type: ["string", "null"] },
            bodyText: { type: "string" },
            markdown: { type: "string" },
            wordCount: { type: "integer" },
            canonicalUrl: { type: "string", format: "uri" },
            pdfUrl: { type: "string", format: "uri" },
          },
        },
        MagazineSummary: {
          type: "object",
          required: ["slug", "title", "url"],
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            displayTitle: { type: "string" },
            publicationDate: { type: ["string", "null"] },
            sourcePdf: { type: "string" },
            pageCount: { type: "integer" },
            articleCount: { type: "integer" },
            url: { type: "string", format: "uri" },
          },
        },
        Magazine: {
          type: "object",
          required: ["slug", "title", "articles"],
          additionalProperties: true,
          properties: {
            slug: { type: "string" },
            title: { type: "string" },
            displayTitle: { type: "string" },
            pageCount: { type: "integer" },
            articleCount: { type: "integer" },
            articles: { type: "array", items: { type: "object", additionalProperties: true } },
            canonicalUrl: { type: "string", format: "uri" },
            pdfUrl: { type: "string", format: "uri" },
          },
        },
        Library: {
          type: "object",
          required: ["magazines", "articles"],
          additionalProperties: true,
          properties: {
            schemaVersion: { type: ["integer", "string"] },
            generatedAt: { type: "string" },
            magazines: { type: "array", items: { type: "object", additionalProperties: true } },
            articles: { type: "array", items: { type: "object", additionalProperties: true } },
          },
        },
        SearchResult: {
          type: "object",
          properties: {
            score: { type: "number" },
            slug: { type: "string" },
            title: { type: "string" },
            magazineTitle: { type: "string" },
            summary: { type: ["string", "null"] },
            snippet: { type: "string" },
            pages: { $ref: "#/components/schemas/PageSpan" },
          },
          additionalProperties: true,
        },
        SearchResponse: {
          type: "object",
          required: ["query", "total", "results"],
          properties: {
            query: { type: "string" },
            total: { type: "integer" },
            results: { type: "array", items: { $ref: "#/components/schemas/SearchResult" } },
          },
        },
        JsonRpcMessage: { type: "object", required: ["jsonrpc"], properties: { jsonrpc: { const: "2.0" }, id: {}, method: { type: "string" } }, additionalProperties: true },
      },
    },
  };
}

function buildApiCatalog(site) {
  return {
    linkset: [
      {
        anchor: `${baseUrl(site)}/.well-known/api-catalog`,
        item: [
          { href: `${baseUrl(site)}/api/openapi.json` },
          { href: `${baseUrl(site)}/api/library.json` },
          { href: `${baseUrl(site)}/api/articles.json` },
          { href: `${baseUrl(site)}/api/magazines.json` },
          { href: `${baseUrl(site)}/api/authors.json` },
          { href: `${baseUrl(site)}/api/search` },
          { href: `${baseUrl(site)}/.well-known/http-message-signatures-directory` },
          { href: `${baseUrl(site)}/llms.txt` },
          { href: `${baseUrl(site)}/llms-full.txt` },
          { href: `${baseUrl(site)}/.well-known/agent.json` },
          { href: `${baseUrl(site)}/.well-known/webmcp.json` },
          { href: `${baseUrl(site)}/.well-known/agent-skills/index.json` },
          { href: `${baseUrl(site)}/.well-known/mcp/server-card.json` },
          { href: `${baseUrl(site)}/.well-known/ai-catalog.json` },
          { href: `${baseUrl(site)}/mcp` },
        ],
      },
    ],
  };
}

function buildMcpServerCard() {
  return {
    $schema: "https://static.modelcontextprotocol.io/schemas/mcp-server-card/v1.json",
    version: "1.0",
    protocolVersion: "2025-11-25",
    serverInfo: {
      name: "proud-archive",
      title: "proud archive MCP server",
      version: "0.2.0",
    },
    description: "Search and retrieve proud.de magazine archive content and metadata.",
    transport: {
      type: "streamable-http",
      endpoint: "/mcp",
    },
    authentication: {
      required: false,
    },
    tools: MCP_TOOLS,
  };
}

function buildAgentManifest(site) {
  return {
    awp_version: "0.2",
    domain: site.domain,
    intent: "Open archive of proud magazine content for reading, search, citation, and machine retrieval.",
    authentication: {
      type: "none",
      required: false,
    },
    protocols: {
      mcp: {
        endpoint: `${baseUrl(site)}/mcp`,
        discovery: `${baseUrl(site)}/.well-known/mcp.json`,
      },
      webmcp: {
        manifest: `${baseUrl(site)}/.well-known/webmcp.json`,
      },
      openapi: {
        url: `${baseUrl(site)}/api/openapi.json`,
      },
      api_catalog: {
        url: `${baseUrl(site)}/.well-known/api-catalog`,
      },
    },
    actions: [
      {
        id: "search_archive",
        name: "Search the archive",
        description: "Search proud articles, issues, and excerpts by keyword.",
        method: "GET",
        endpoint: "/api/search",
        via: ["mcp", "webmcp", "openapi"],
        params: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search query" },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["q"],
        },
      },
      {
        id: "read_article",
        name: "Read an article",
        description: "Fetch the full structured JSON for a known article slug.",
        method: "GET",
        endpoint: "/api/articles/{slug}.json",
        via: ["mcp", "webmcp", "openapi"],
      },
      {
        id: "read_issue",
        name: "Read an issue",
        description: "Fetch the full structured JSON for a magazine issue slug.",
        method: "GET",
        endpoint: "/api/magazines/{slug}.json",
        via: ["mcp", "webmcp", "openapi"],
      },
    ],
  };
}

function buildWebMcpManifest(site) {
  return {
    manifest_version: "0.1",
    name: "proud archive",
    version: "0.2.0",
    description: "Read-only WebMCP tool catalog for the proud archive.",
    homepage_url: `${baseUrl(site)}/`,
    tools: [
      {
        name: "search_archive",
        description: "Search proud archive articles, issues, and excerpts by keyword.",
        endpoint: {
          method: "GET",
          url: `${baseUrl(site)}/api/search`,
        },
        input_schema: {
          type: "object",
          properties: {
            q: { type: "string", description: "Search query" },
            limit: { type: "integer", minimum: 1, maximum: 50 },
          },
          required: ["q"],
        },
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: "get_article",
        description: "Read the structured JSON representation of one article by slug.",
        endpoint: {
          method: "GET",
          url: `${baseUrl(site)}/api/articles/{slug}.json`,
        },
        input_schema: {
          type: "object",
          properties: {
            slug: { type: "string" },
          },
          required: ["slug"],
        },
        annotations: {
          readOnlyHint: true,
        },
      },
      {
        name: "get_issue",
        description: "Read the structured JSON representation of one magazine issue by slug.",
        endpoint: {
          method: "GET",
          url: `${baseUrl(site)}/api/magazines/{slug}.json`,
        },
        input_schema: {
          type: "object",
          properties: {
            slug: { type: "string" },
          },
          required: ["slug"],
        },
        annotations: {
          readOnlyHint: true,
        },
      },
    ],
  };
}

function buildAiCatalog(site) {
  const host = new URL(baseUrl(site)).hostname;
  return {
    specVersion: "1.0",
    host: {
      displayName: "proud magazine archive",
      identifier: `did:web:${host}`,
    },
    entries: [
      {
        identifier: `urn:air:${host}:server:proud-archive`,
        displayName: "proud archive MCP server",
        description: "Read-only MCP server: list issues and articles, search full text, fetch article and issue payloads.",
        type: "application/mcp-server-card+json",
        url: `${baseUrl(site)}/.well-known/mcp/server-card.json`,
        representativeQueries: [
          "find proud magazine articles about Berlin techno",
          "get the full text of the proud article love in berlin",
          "list the articles in proud issue 01",
        ],
      },
      {
        identifier: `urn:air:${host}:skill:proud-archive-search`,
        displayName: "proud archive search skill",
        description: "Agent Skill: search and retrieve proud archive content via MCP, llms.txt or the JSON API.",
        type: 'text/markdown; profile="urn:air:agent-skills"',
        url: `${baseUrl(site)}/.well-known/agent-skills/proud-archive-search/SKILL.md`,
        representativeQueries: [
          "search the proud archive for DJ interviews",
          "how do I fetch a proud article as Markdown",
        ],
      },
      {
        identifier: `urn:air:${host}:skill:proud-archive-citation`,
        displayName: "proud archive citation skill",
        description: "Agent Skill: cite proud archive material with issue, page span and PDF URL.",
        type: 'text/markdown; profile="urn:air:agent-skills"',
        url: `${baseUrl(site)}/.well-known/agent-skills/proud-archive-citation/SKILL.md`,
        representativeQueries: [
          "how do I cite a proud magazine article with page numbers",
          "which issue and pages is a proud article from",
        ],
      },
    ],
  };
}

const WEBMCP_SCRIPT = `// WebMCP: expose the existing read-only archive endpoints as in-page tools.
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
`;

function buildHttpMessageSignaturesDirectory() {
  return {
    keys: [],
  };
}

const BRAND_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "brand");

// Width/height straight from the WebP header (VP8, VP8L, VP8X) so <img> tags reserve space (no CLS).
function webpSize(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = buffer.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    return { width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
  }
  if (chunk === "VP8L") {
    const bits = buffer.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >> 14) & 0x3fff) };
  }
  if (chunk === "VP8 ") {
    return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

async function recordImageSizes(dir, routePrefix) {
  if (!(await fs.stat(dir).catch(() => null))?.isDirectory()) {
    return;
  }
  for (const filePath of await walkFiles(dir)) {
    if (!filePath.endsWith(".webp")) {
      continue;
    }
    const handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(32);
    await handle.read(header, 0, 32, 0);
    await handle.close();
    const size = webpSize(header);
    if (size) {
      IMAGE_SIZES.set(`${routePrefix}/${path.relative(dir, filePath).split(path.sep).join("/")}`, size);
    }
  }
}

async function walkFiles(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkFiles(absolutePath));
    } else if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function optimizeImageTree(sourceDir, targetDir, { maxDimension, quality }) {
  await fs.rm(targetDir, { recursive: true, force: true });
  await fs.mkdir(targetDir, { recursive: true });
  if (!(await fs.stat(sourceDir).catch(() => null))?.isDirectory()) {
    return;
  }

  const sourceFiles = await walkFiles(sourceDir);
  const imageFiles = sourceFiles.filter((filePath) => IMAGE_EXTENSION_RE.test(filePath));

  for (const sourceFile of imageFiles) {
    const relativePath = path.relative(sourceDir, sourceFile);
    const targetFile = path.join(targetDir, optimizedImagePath(relativePath));
    const tempFile = `${targetFile}.tmp${path.extname(sourceFile).toLowerCase() || ".png"}`;

    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await execFileAsync("sips", ["-Z", String(maxDimension), sourceFile, "--out", tempFile]);
    await execFileAsync("cwebp", ["-quiet", "-q", String(quality), tempFile, "-o", targetFile]);
    await fs.rm(tempFile, { force: true });
  }
}

async function main() {
  const site = await ensureWorkspace();
  const library = await loadLibrary();
  site.generatedAt = new Date().toISOString();
  const locales = [...new Set([site.defaultLocale, ...(site.locales ?? [])])];
  const articles = await Promise.all(
    library.articles.map((article) => readJson(path.join(site.paths.outputDir, article.file))),
  );
  const magazines = await Promise.all(
    library.magazines.map((magazine) => readJson(path.join(site.paths.outputDir, magazine.file))),
  );
  const sortedArticles = sortArticles(articles);
  const enrichmentEntries = await Promise.all(
    sortedArticles.map(async (article) => [article.slug, await loadArticleEnrichment(site, article.slug)]),
  );
  const enrichmentBySlug = new Map(enrichmentEntries);

  await ensureCleanDir(site.paths.siteOutputDir);
  await fs.writeFile(path.join(site.paths.siteOutputDir, ".gitkeep"), "", "utf8");

  await optimizeImageTree(path.join(site.paths.outputDir, "previews"), path.join(site.paths.siteOutputDir, "assets", "previews"), {
    maxDimension: 900,
    quality: 76,
  });
  await optimizeImageTree(path.join(site.paths.outputDir, "hero"), path.join(site.paths.siteOutputDir, "assets", "hero"), {
    maxDimension: 1600,
    quality: 80,
  });
  await optimizeImageTree(path.join(site.paths.outputDir, "page-images"), path.join(site.paths.siteOutputDir, "assets", "page-images"), {
    maxDimension: 1400,
    quality: 82,
  });
  await fs.mkdir(path.join(site.paths.siteOutputDir, "assets", "pdfs"), { recursive: true });
  await writeText(site, "/assets/site.css", `${CSS}\n${EDITORIAL_CSS_SOURCE}`);
  await writeText(site, "/assets/webmcp.js", WEBMCP_SCRIPT);
  for (const [from, to] of [["favicon.ico", "favicon.ico"], ["logo.png", "assets/logo.png"]]) {
    await fs.copyFile(path.join(BRAND_DIR, from), path.join(site.paths.siteOutputDir, to));
  }
  await fs.mkdir(path.join(site.paths.siteOutputDir, "assets", "fonts"), { recursive: true });
  for (const font of (await fs.readdir(path.join(BRAND_DIR, "fonts"))).filter((name) => name.endsWith(".woff2"))) {
    await fs.copyFile(path.join(BRAND_DIR, "fonts", font), path.join(site.paths.siteOutputDir, "assets", "fonts", font));
  }
  for (const tree of ["previews", "hero", "page-images"]) {
    await recordImageSizes(path.join(site.paths.siteOutputDir, "assets", tree), `/assets/${tree}`);
  }
  const issueDates = await readOptionalJson(path.join(path.dirname(site.paths.enrichmentDir), "issue-dates.json"));
  for (const [magazineSlug, issueNumber] of Object.entries(issueDates?.magazines ?? {})) {
    const isoDate = issueDates.issues?.[issueNumber];
    if (isoDate) {
      ISSUE_DATES.set(magazineSlug, isoDate);
    }
  }
  CONTENT_MODIFIED_AT = library.generatedAt ? String(library.generatedAt).slice(0, 10) : null;
  EDITORIAL = await loadEditorialData(PROJECT_ROOT);
  PEOPLE = buildPeople(EDITORIAL, sortedArticles);
  for (const person of PEOPLE) PEOPLE_BY_SLUG.set(person.slug, person);

  const localizedByLocale = new Map();
  for (const locale of locales) {
    const localizedArticles = [];
    for (const article of sortedArticles) {
      localizedArticles.push(await localizeArticle(site, article, locale));
    }
    localizedByLocale.set(locale, localizedArticles);
  }

  for (const locale of locales) {
    const localizedArticles = localizedByLocale.get(locale);
    const decoratedArticles = localizedArticles.map((article) =>
      withPresentationEnrichment(article, locale, localizedArticles, enrichmentBySlug.get(article.slug) ?? null),
    );
    localizedByLocale.set(locale, decoratedArticles);
  }

  for (const locale of locales) {
    const localizedArticles = localizedByLocale.get(locale);
    const localizedArticleMap = new Map(localizedArticles.map((article) => [article.slug, article]));
    ARTICLES_BY_SLUG.clear();
    for (const article of localizedArticles) ARTICLES_BY_SLUG.set(article.slug, article);
    const issueOrderedArticles = sortArticlesForIssue(localizedArticles);
    const wordRankedArticles = sortArticlesByWordCount(localizedArticles);

    await writePage(
      site,
      homeRoute(site, locale),
      buildIndexHtml(site, locale, localizedArticles, magazines, locales),
      buildIndexMarkdown(site, locale, localizedArticles, magazines),
    );

    const articlesListMarkdown = buildListPageMarkdown(
      site,
      locale,
      ui(locale).allArticles,
      routeForArticlesIndex(site, locale),
      localizedArticles.map(
        (article) =>
          `- [${article.title}](${baseUrl(site)}${routeForArticle(site, locale, article.slug)}index.md): ${displaySummaryForArticle(article, locale)}`,
      ),
      "articles-index",
    );
    const articlesListHtml = buildListPageHtml(
      site,
      locale,
      ui(locale).allArticles,
      routeForArticlesIndex(site, locale),
      `${routeForArticlesIndex(site, locale)}index.md`,
      `
        <h2 class="section-label">${escapeHtml(ui(locale).sortedByWordCount)}</h2>
        <ol class="article-list">
          ${wordRankedArticles.map((article) => renderArticleReviewCard(site, locale, article, { showMagazine: true })).join("")}
        </ol>
        <h2 class="section-label" style="margin-top:1.5rem">${escapeHtml(ui(locale).inIssueOrder)}</h2>
        <ol class="article-list">
          ${issueOrderedArticles.map((article) => renderArticleReviewCard(site, locale, article, { showMagazine: true })).join("")}
        </ol>`,
      isEnglishLocale(locale)
        ? "A reading-first index of proud stories with clean text pages, original scans, and issue navigation."
        : "Ein leseoptimierter Index der proud-Geschichten mit klaren Textseiten, Originalscans und Heftnavigation.",
      articleCoverHref(wordRankedArticles[0]) ?? null,
      "articles",
      locales,
    );
    await writePage(site, routeForArticlesIndex(site, locale), articlesListHtml, articlesListMarkdown);

    const localizedMagazineMarkdown = buildListPageMarkdown(
      site,
      locale,
      ui(locale).allMagazines,
      routeForMagazinesIndex(site, locale),
      magazines.map(
        (magazine) =>
          `- [${displayMagazineTitle(magazine, locale)}](${baseUrl(site)}${routeForMagazine(site, locale, magazine.slug)}index.md): ${magazine.articleCount} ${ui(locale).articles}`,
      ),
      "magazines-index",
    );
    const localizedMagazineHtml = buildListPageHtml(
      site,
      locale,
      ui(locale).allMagazines,
      routeForMagazinesIndex(site, locale),
      `${routeForMagazinesIndex(site, locale)}index.md`,
      `<ol class="issue-grid">${magazines.map((magazine) => renderMagazineReviewCard(site, locale, magazine)).join("")}</ol>`,
      isEnglishLocale(locale)
        ? "All proud issues in a clean reading archive with direct access to issue pages and article editions."
        : "Alle proud-Ausgaben in einem klaren Lesearchiv mit direktem Zugang zu Heften und Artikelseiten.",
      articleCoverHref(localizedArticles[0]) ?? null,
      "issues",
      locales,
    );
    await writePage(site, routeForMagazinesIndex(site, locale), localizedMagazineHtml, localizedMagazineMarkdown);

    for (const localized of localizedArticles) {
      const manualEnrichment = enrichmentBySlug.get(localized.slug) ?? null;
      await writePage(
        site,
        routeForArticle(site, locale, localized.slug),
        buildArticleHtml(site, localized, locale, locales, localizedArticles, manualEnrichment),
        buildArticleMarkdown(site, localized, locale, localizedArticles, manualEnrichment),
      );
    }

    for (const magazine of magazines) {
      const relatedArticles = magazine.articles
        .map((entry) => localizedArticleMap.get(entry.slug))
        .filter(Boolean);
      await writePage(
        site,
        routeForMagazine(site, locale, magazine.slug),
        buildMagazineHtml(site, locale, magazine, relatedArticles, locales),
        buildMagazineMarkdown(site, locale, magazine, relatedArticles),
      );
    }

    const staticContext = { publishedIssues: magazines.length, articleCount: localizedArticles.length, authorCount: PEOPLE.length };
    const staticKeys = [...STATIC_PAGES, ...(legalPagesEnabled() ? ["impressum", "datenschutz"] : [])];
    for (const key of staticKeys) {
      const page = buildStaticPage(site, locale, key, locales, staticContext);
      await writePage(site, page.route, page.html, page.markdown);
    }
    const authorsIndex = buildAuthorsIndex(site, locale, locales);
    await writePage(site, authorsIndex.route, authorsIndex.html, authorsIndex.markdown);
    for (const person of PEOPLE) {
      const page = buildAuthorPage(site, locale, person, locales);
      await writePage(site, page.route, page.html, page.markdown);
    }

    const llmsLines = [
      `# ${site.siteTitle} (${localeLabel(locale)})`,
      `> ${siteDescription(site, locale)}`,
      "",
      "## Key Resources",
      `- [Archive Home](${baseUrl(site)}${homeRoute(site, locale)}index.md): Root overview of the archive.`,
      `- [Articles Index](${baseUrl(site)}${routeForArticlesIndex(site, locale)}index.md): All article pages in ${localeLabel(locale)} routing.`,
      `- [Magazines Index](${baseUrl(site)}${routeForMagazinesIndex(site, locale)}index.md): All magazine issues.`,
      `- [OpenAPI](${baseUrl(site)}/api/openapi.json): Machine-readable API description.`,
      `- [MCP Server Card](${baseUrl(site)}/.well-known/mcp/server-card.json): Remote MCP discovery document.`,
      `- [Authors](${baseUrl(site)}${routeForStatic(site, locale, "authors")}index.md): Everyone credited in print, with roles and articles. JSON: ${baseUrl(site)}/api/authors.json`,
      "",
      "## About the magazine",
      ...staticKeys.map((key) => `- [${staticPageTitle(key, locale)}](${baseUrl(site)}${routeForStatic(site, locale, key)}index.md): ${staticPageDescription(key, locale)}`),
      `- Library record: German National Library, shelf mark ${DNB_SHELF}, ZDB ${ZDB_ID}, ${DNB_URL}`,
      "",
      "## Authors",
      ...PEOPLE.map((person) => `- [${person.name}](${baseUrl(site)}${routeForAuthor(site, locale, person.slug)}index.md): ${personRoleLabels(person, locale).join(", ")}`),
      "",
      "## Articles",
      ...localizedArticles.map(
        (article) =>
          `- [${article.title}](${baseUrl(site)}${routeForArticle(site, locale, article.slug)}index.md): ${displaySummaryForArticle(article, locale)}`,
      ),
      "",
    ];

    const llmsFull = [
      `# ${site.siteTitle} Full Archive (${localeLabel(locale)})`,
      "",
      ...localizedArticles.flatMap((article) => [
        `## ${article.title}`,
        `Source: ${article.sourcePdf} | Pages: ${article.pages.start}-${article.pages.end}`,
        "",
        article.markdown,
        "",
      ]),
    ].join("\n");

    await writeText(site, routeForLlms(site, locale), `${llmsLines.join("\n")}\n`);
    await writeText(site, routeForLlmsFull(site, locale), `${llmsFull}\n`);
  }

  const apiArticles = sortedArticles.map((article) => ({
    slug: article.slug,
    title: article.title,
    magazineSlug: article.magazineSlug,
    magazineTitle: article.magazineTitle,
    magazineDisplayTitle: displayMagazineTitle(article, site.defaultLocale),
    summary: article.summary,
    excerpt: article.excerpt,
    pages: article.pages,
    sourcePdf: article.sourcePdf,
    previewImage: articleCoverHref(article) ? `${baseUrl(site)}${articleCoverHref(article)}` : null,
    heroImage: heroHref(article) ? `${baseUrl(site)}${heroHref(article)}` : null,
    credits: bylineFor(EDITORIAL, article, PEOPLE_BY_SLUG, "en").authors.concat(bylineFor(EDITORIAL, article, PEOPLE_BY_SLUG, "en").secondary).map((entry) => ({ name: entry.name, label: entry.label, author: entry.slug ? `${baseUrl(site)}/authors/${entry.slug}/` : null })),
    pageImageCount: article.pageImages?.length ?? 0,
    url: `${baseUrl(site)}${routeForArticle(site, site.defaultLocale, article.slug)}`,
  }));

  const apiMagazines = magazines.map((magazine) => ({
    slug: magazine.slug,
    title: magazine.title,
    displayTitle: displayMagazineTitle(magazine, site.defaultLocale),
    publicationDate: magazine.publicationDate,
    sourcePdf: magazine.sourcePdf,
    pageCount: magazine.pageCount,
    articleCount: magazine.articleCount,
    url: `${baseUrl(site)}${routeForMagazine(site, site.defaultLocale, magazine.slug)}`,
  }));

  await writeJson(site, "/api/library.json", library);
  await writeJson(site, "/api/articles.json", apiArticles);
  await writeJson(site, "/api/magazines.json", apiMagazines);
  await writeJson(site, "/api/authors.json", PEOPLE.map((person) => ({
    slug: person.slug,
    name: person.name,
    printedAs: person.printedAs,
    roles: personRoleLabels(person, "en"),
    masthead: person.mastheadRoles.map((role) => ({ issue: role.magazineSlug, role: role.en, page: role.page })),
    credits: person.credits.map((credit) => ({ article: credit.articleSlug, issue: credit.magazineSlug, role: credit.role, printedLabel: credit.printedLabel, printedName: credit.printedName })),
    bio: person.bio ? { text: person.bio, language: "de", source: person.bioSource } : null,
    url: `${baseUrl(site)}${routeForAuthor(site, site.defaultLocale, person.slug)}`,
  })));
  await writeJson(site, "/api/search-index.json", sortedArticles);
  await writeJson(site, "/api/openapi.json", buildOpenApi(site));

  for (const article of sortedArticles) {
    const localized = {};
    const enrichment = {};
    const manualEnrichment = enrichmentBySlug.get(article.slug) ?? null;
    for (const locale of locales) {
      const candidate = localizedByLocale.get(locale).find((entry) => entry.slug === article.slug);
      const articleBody = buildPublishedArticleBody(candidate);
      const derived = buildArticleEnrichment(candidate, locale, articleBody, localizedByLocale.get(locale), manualEnrichment);
      localized[locale] = {
        title: candidate.title,
        summary: candidate.summary,
        excerpt: candidate.excerpt,
        translationState: candidate.translationState,
      };
      enrichment[locale] = {
        kicker: derived.kicker,
        heroCaption: derived.heroCaption,
        topics: derived.topics,
        quickPoints: derived.quickPoints,
        relatedLinks: derived.relatedLinks,
        videos: derived.videos,
        relatedArticles: derived.relatedArticles.map((entry) => entry.slug),
        readingTime: derived.readingTime,
      };
    }

    await writeJson(site, `/api/articles/${article.slug}.json`, {
      ...article,
      locales: localized,
      enrichment,
      canonicalUrl: `${baseUrl(site)}${routeForArticle(site, site.defaultLocale, article.slug)}`,
      pdfUrl: `${baseUrl(site)}${articlePdfHref(article)}`,
      previewUrl: articleCoverHref(article) ? `${baseUrl(site)}${articleCoverHref(article)}` : null,
      heroUrl: heroHref(article) ? `${baseUrl(site)}${heroHref(article)}` : null,
      contentBlocks: (article.contentBlocks ?? []).map((block) => ({
        ...block,
        pageImage: block.pageImage
          ? {
              ...block.pageImage,
              url: `${baseUrl(site)}${articlePageImageHref(block.pageImage)}`,
            }
          : null,
      })),
      pageImages: (article.pageImages ?? []).map((entry) => ({
        ...entry,
        url: `${baseUrl(site)}${articlePageImageHref(entry)}`,
      })),
    });
  }

  for (const magazine of magazines) {
    await writeJson(site, `/api/magazines/${magazine.slug}.json`, {
      ...magazine,
      displayTitle: displayMagazineTitle(magazine, site.defaultLocale),
      canonicalUrl: `${baseUrl(site)}${routeForMagazine(site, site.defaultLocale, magazine.slug)}`,
      pdfUrl: `${baseUrl(site)}/assets/pdfs/${encodeURIComponent(magazine.sourcePdf)}`,
    });
  }

  await writeText(site, "/robots.txt", buildRobots(site));
  // Pages only (plus the llms.txt reading lists); /.well-known/* discovery documents are not pages.
  // Each HTML page carries its language alternates (de, en, x-default = German default locale).
  const sitemapAlternates = new Map();
  const addPageGroup = (entries) => {
    const defaultEntry = entries.find((entry) => entry.locale === site.defaultLocale);
    const links = [...entries, ...(defaultEntry ? [{ locale: "x-default", route: defaultEntry.route }] : [])];
    for (const entry of entries) {
      sitemapAlternates.set(entry.route, links);
    }
  };
  addPageGroup(locales.map((locale) => ({ locale, route: homeRoute(site, locale) })));
  addPageGroup(locales.map((locale) => ({ locale, route: routeForArticlesIndex(site, locale) })));
  addPageGroup(locales.map((locale) => ({ locale, route: routeForMagazinesIndex(site, locale) })));
  const defaultLocalized = localizedByLocale.get(site.defaultLocale);
  for (const article of defaultLocalized) {
    addPageGroup(articleAlternateEntries(site, article, locales));
  }
  for (const magazine of magazines) {
    addPageGroup(renderAlternates(site, magazine, routeForMagazine, locales));
  }
  for (const key of [...STATIC_PAGES, "authors", ...(legalPagesEnabled() ? ["impressum", "datenschutz"] : [])]) {
    addPageGroup(locales.map((locale) => ({ locale, route: routeForStatic(site, locale, key) })));
  }
  for (const person of PEOPLE) {
    addPageGroup(locales.map((locale) => ({ locale, route: routeForAuthor(site, locale, person.slug) })));
  }
  const sitemapRoutes = new Set(["/llms.txt", "/llms-full.txt", ...sitemapAlternates.keys()]);
  for (const locale of locales) {
    sitemapRoutes.add(routeForLlms(site, locale));
    sitemapRoutes.add(routeForLlmsFull(site, locale));
  }

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[...sitemapRoutes]
  .sort()
  .map((route) => {
    const links = (sitemapAlternates.get(route) ?? [])
      .map((entry) => `<xhtml:link rel="alternate" hreflang="${entry.locale}" href="${baseUrl(site)}${entry.route}"/>`)
      .join("");
    return `  <url><loc>${baseUrl(site)}${route}</loc>${links}</url>`;
  })
  .join("\n")}
</urlset>
`;
  await writeText(site, "/sitemap.xml", sitemap);

  const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeHtml(site.siteTitle)}</title>
    <link>${baseUrl(site)}/</link>
    <description>${escapeHtml(siteDescription(site, site.defaultLocale))}</description>
    <lastBuildDate>${new Date(library.generatedAt ?? Date.now()).toUTCString()}</lastBuildDate>
    ${sortedArticles
      .slice(0, 25)
      .map(
        (article) => `
    <item>
      <title>${escapeHtml(article.title)}</title>
      <link>${baseUrl(site)}${routeForArticle(site, site.defaultLocale, article.slug)}</link>
      <description>${escapeHtml(article.summary ?? article.excerpt ?? "")}</description>
      <guid>${baseUrl(site)}${routeForArticle(site, site.defaultLocale, article.slug)}</guid>
    </item>`,
      )
      .join("")}
  </channel>
</rss>
`;
  await writeText(site, "/feed.xml", rss);

  const skillSearch = `---
name: proud-archive-search
description: Search the proud.de archive and retrieve article text, metadata, PDFs, and machine-readable JSON. Use when a task needs material from the proud magazine archive.
---

# proud archive search

Start with the MCP server card at [/.well-known/mcp/server-card.json](/.well-known/mcp/server-card.json).

If MCP is unavailable, use the read-only HTTP API:

- \`GET /api/search?q=...\` for keyword or question search
- \`GET /api/articles/{slug}.json\` for a full article payload
- \`GET /api/magazines/{slug}.json\` for an issue overview
- \`GET /llms.txt\` or locale-specific \`/en/llms.txt\` for a compact reading list

Prefer Markdown article URLs ending in \`/index.md\` when ingesting content into an LLM context window.
`;
  const skillCite = `---
name: proud-archive-citation
description: Cite proud archive material with article slug, issue, page span, and PDF URL. Use when answering questions with sourced excerpts from the archive.
---

# proud archive citation

When citing proud archive material:

1. Include the article title and slug.
2. Include the magazine title or slug.
3. Include the original PDF filename and page range.
4. Prefer the Markdown page URL and the original PDF URL.

Example citation fields:

- article: \`Cognetive Cities\`
- slug: \`cognetive-cities\`
- issue: \`22-proud-magazine-2011\`
- pages: \`45-62\`
- markdown: \`https://proud.de/articles/cognetive-cities/index.md\`
- pdf: \`https://proud.de/assets/pdfs/22-proud-magazine-2011.pdf#page=45\`
`;
  const searchSkillDigest = digestForText(skillSearch);
  const citeSkillDigest = digestForText(skillCite);
  await writeText(site, "/.well-known/agent-skills/proud-archive-search/SKILL.md", skillSearch);
  await writeText(site, "/.well-known/agent-skills/proud-archive-citation/SKILL.md", skillCite);
  await writeJson(site, "/.well-known/agent-skills/index.json", {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [
      {
        name: "proud-archive-search",
        type: "skill-md",
        description: "Search and retrieve proud.de archive content via MCP, llms.txt, or JSON endpoints.",
        url: "/.well-known/agent-skills/proud-archive-search/SKILL.md",
        digest: searchSkillDigest,
      },
      {
        name: "proud-archive-citation",
        type: "skill-md",
        description: "Cite proud archive content with stable URLs, issue identifiers, and page spans.",
        url: "/.well-known/agent-skills/proud-archive-citation/SKILL.md",
        digest: citeSkillDigest,
      },
    ],
  });

  const mcpServerCard = buildMcpServerCard();
  await writeJson(site, "/.well-known/mcp/server-card.json", mcpServerCard);
  await writeJson(site, "/.well-known/mcp.json", mcpServerCard);
  await writeJson(site, "/.well-known/agent.json", buildAgentManifest(site));
  await writeJson(site, "/.well-known/webmcp.json", buildWebMcpManifest(site));
  await writeJson(site, "/.well-known/ai-catalog.json", buildAiCatalog(site));
  await writeJson(site, "/.well-known/http-message-signatures-directory/index.json", buildHttpMessageSignaturesDirectory());

  await writeJson(site, "/.well-known/api-catalog", buildApiCatalog(site));

  const headerLines = [
    "/*",
    "  X-Robots-Tag: all",
    "  Link: </sitemap.xml>; rel=\"sitemap\"",
    "  Link: </.well-known/api-catalog>; rel=\"api-catalog\"",
    "  Link: </.well-known/agent-skills/index.json>; rel=\"agent-skills\"",
    "  Link: </.well-known/webmcp.json>; rel=\"webmcp\"",
    "  Link: </.well-known/mcp/server-card.json>; rel=\"mcp-server\"",
    "  Link: </.well-known/ai-catalog.json>; rel=\"ai-catalog\"; type=\"application/json\"",
    "",
    "/*.md",
    "  Content-Type: text/markdown; charset=utf-8",
    "",
    "/.well-known/api-catalog",
    "  Content-Type: application/linkset+json; profile=\"https://www.rfc-editor.org/info/rfc9727\"",
    "",
    "/.well-known/ai-catalog.json",
    "  Content-Type: application/json; charset=utf-8",
    "  Access-Control-Allow-Origin: *",
    "",
    "/assets/hero/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/assets/previews/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/assets/page-images/*",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
    "/.well-known/http-message-signatures-directory",
    "  Content-Type: application/http-message-signatures-directory+json",
    "",
  ];

  await writeText(site, "/_headers", `${headerLines.join("\n")}\n`);
  console.log(`Site build complete: ${site.paths.siteOutputDir}`);
  console.log("Page images were copied into the site output. Original PDFs should be served from R2 or another object store in production.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
