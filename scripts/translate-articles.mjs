import fs from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace, PROJECT_ROOT, resolveCliOption } from "../src/lib/config.mjs";
import { loadLocalEnv } from "../src/lib/env.mjs";
import { detectArticleLanguage, hasMeaningfulTranslation } from "../src/lib/i18n.mjs";
import { loadLibrary } from "../src/lib/store.mjs";

const OPENROUTER_URL = process.env.PROUD_OPENROUTER_URL ?? "https://openrouter.ai/api/v1/chat/completions";
const MODEL = process.env.PROUD_TRANSLATION_MODEL ?? process.env.PROUD_OCR_OPENROUTER_MODEL ?? "google/gemini-2.5-flash";
const REFERER = process.env.PROUD_OPENROUTER_REFERER ?? "https://proud.de";
const TITLE = process.env.PROUD_OPENROUTER_TITLE ?? "proud-archive-translation";

function cleanJsonText(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return "";
  }

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    return fenceMatch[1].trim();
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}

function parseJsonResponse(value) {
  return JSON.parse(cleanJsonText(value));
}

async function callOpenRouter(apiKey, payload) {
  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": REFERER,
      "X-Title": TITLE,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`OpenRouter translation failed (${response.status}): ${text.slice(0, 800)}`);
  }

  const parsed = JSON.parse(text);
  const content = parsed?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("OpenRouter translation returned no content.");
  }

  return parseJsonResponse(content);
}

async function readArticle(site, article) {
  const articlePath = path.join(site.paths.outputDir, article.file);
  const raw = await fs.readFile(articlePath, "utf8");
  return JSON.parse(raw);
}

function clampText(text, limit) {
  const value = String(text ?? "").trim();
  if (value.length <= limit) {
    return value;
  }

  return `${value.slice(0, limit).trimEnd()}…`;
}

function buildPrompt(article, locale) {
  return [
    {
      role: "system",
      content: [
        "You translate and lightly editorially clean magazine archive content.",
        "Preserve meaning, preserve markdown structure, preserve headings, lists, bold text and links.",
        "Do not invent facts. Do not omit important names, places or references.",
        "Return valid JSON only with these keys: title, summary, excerpt, markdown, description.",
        "summary must be a concise TL;DR in the target language with 2 to 4 sentences.",
        "excerpt must be a short readable opening excerpt in the target language, max 320 characters.",
        "description must be one sentence for meta description use.",
      ].join(" "),
    },
    {
      role: "user",
      content: [
        `Target language: ${locale}`,
        `Source language: ${detectArticleLanguage(article)}`,
        `Article title: ${article.title}`,
        `Magazine: ${article.magazineTitle}`,
        `Pages: ${article.pages.start}-${article.pages.end}`,
        article.authors?.length ? `Authors: ${article.authors.join(", ")}` : null,
        "",
        "Translate this markdown:",
        "",
        clampText(article.markdown ?? "", 18000),
      ].filter(Boolean).join("\n"),
    },
  ];
}

async function loadExistingTranslation(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function main() {
  const localEnv = await loadLocalEnv(PROJECT_ROOT);
  Object.assign(process.env, localEnv, process.env);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY fehlt.");
  }

  const args = process.argv.slice(2);
  const locale = resolveCliOption(args, "--locale") ?? "en";
  const magazineSlug = resolveCliOption(args, "--magazine");
  const refresh = new Set(["1", "true", "yes", "on"]).has(String(resolveCliOption(args, "--refresh") ?? "0").toLowerCase());
  const limit = Number(resolveCliOption(args, "--limit") ?? "0") || 0;

  const site = await ensureWorkspace();
  const library = await loadLibrary();
  const selectedEntries = library.articles
    .filter((article) => !magazineSlug || article.magazineSlug === magazineSlug)
    .sort((left, right) => left.pages.start - right.pages.start || left.title.localeCompare(right.title, "de"));

  const worklist = limit > 0 ? selectedEntries.slice(0, limit) : selectedEntries;
  let translated = 0;
  let skipped = 0;

  for (const entry of worklist) {
    const translationPath = path.join(site.paths.translationDir, locale, `${entry.slug}.json`);
    const existing = await loadExistingTranslation(translationPath);
    if (!refresh && hasMeaningfulTranslation(existing)) {
      skipped += 1;
      console.log(`Skip ${entry.slug} (${locale})`);
      continue;
    }

    const article = await readArticle(site, entry);
    const sourceLanguage = detectArticleLanguage(article);
    if (!refresh && sourceLanguage === locale) {
      skipped += 1;
      console.log(`Skip ${entry.slug} (${locale}, source already ${locale})`);
      continue;
    }

    console.log(`Translate ${entry.slug} -> ${locale}`);
    const payload = await callOpenRouter(apiKey, {
      model: MODEL,
      temperature: 0.2,
      messages: buildPrompt(article, locale),
      response_format: { type: "json_object" },
    });

    const translation = {
      locale,
      slug: article.slug,
      sourceTitle: article.title,
      detectedLanguage: detectArticleLanguage(article),
      title: payload.title ?? null,
      summary: payload.summary ?? null,
      excerpt: payload.excerpt ?? null,
      bodyText: null,
      markdown: payload.markdown ?? null,
      description: payload.description ?? null,
      notes: "Generated via OpenRouter translation pipeline.",
    };

    await fs.mkdir(path.dirname(translationPath), { recursive: true });
    await fs.writeFile(translationPath, `${JSON.stringify(translation, null, 2)}\n`, "utf8");
    translated += 1;
  }

  console.log(`Translations complete for ${locale}: ${translated} written, ${skipped} skipped.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
