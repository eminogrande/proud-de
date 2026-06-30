import fs from "node:fs/promises";
import path from "node:path";

const LANGUAGE_HINTS = {
  de: [
    " und ",
    " der ",
    " die ",
    " das ",
    " ist ",
    " mit ",
    " ein ",
    " eine ",
    " nicht ",
    " auf ",
    " ich ",
    " wir ",
    " für ",
    " berlin ",
  ],
  en: [
    " and ",
    " the ",
    " is ",
    " with ",
    " this ",
    " that ",
    " for ",
    " from ",
    " have ",
    " city ",
    " berlin ",
    " you ",
    " are ",
  ],
};

function normalizeText(value) {
  return ` ${String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim()} `;
}

function countNeedles(haystack, needles) {
  return needles.reduce((score, needle) => {
    let count = 0;
    let offset = 0;

    while (true) {
      const index = haystack.indexOf(needle, offset);
      if (index === -1) {
        return score + count;
      }

      count += 1;
      offset = index + needle.length;
    }
  }, 0);
}

export function detectLanguageFromText(text) {
  const normalized = normalizeText(text);
  const deScore = countNeedles(normalized, LANGUAGE_HINTS.de);
  const enScore = countNeedles(normalized, LANGUAGE_HINTS.en);

  if (deScore >= 3 && deScore >= enScore * 1.2) {
    return "de";
  }

  if (enScore >= 3 && enScore >= deScore * 1.2) {
    return "en";
  }

  if (deScore > 0 && enScore > 0) {
    return "mixed";
  }

  return "und";
}

export function detectArticleLanguage(article, fallbackLocale = "de") {
  const sample = [
    article.summary ?? "",
    article.excerpt ?? "",
    String(article.bodyText ?? "").slice(0, 4000),
  ].join("\n\n");
  const detected = detectLanguageFromText(sample);
  return detected === "und" ? fallbackLocale : detected;
}

export async function loadTranslation(site, locale, slug) {
  const translationPath = path.join(site.paths.translationDir, locale, `${slug}.json`);

  try {
    const raw = await fs.readFile(translationPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }

    throw error;
  }
}

export function hasMeaningfulTranslation(translation) {
  if (!translation) {
    return false;
  }

  return ["title", "summary", "excerpt", "bodyText", "markdown", "description"].some((key) => {
    const value = translation[key];
    return typeof value === "string" && value.trim().length > 0;
  });
}

export async function getAvailableTranslationLocales(site, article) {
  const locales = new Set();
  const detectedLanguage = detectArticleLanguage(article, site.defaultLocale);
  const originalLocale = detectedLanguage === "und" ? site.defaultLocale : detectedLanguage;

  locales.add(originalLocale);

  for (const locale of site.locales ?? [site.defaultLocale]) {
    const translation = await loadTranslation(site, locale, article.slug);
    if (hasMeaningfulTranslation(translation)) {
      locales.add(locale);
    }
  }

  return [...locales];
}

export async function localizeArticle(site, article, locale) {
  const translation = await loadTranslation(site, locale, article.slug);
  const detectedLanguage = detectArticleLanguage(article, site.defaultLocale);
  const originalLocale = detectedLanguage === "und" ? site.defaultLocale : detectedLanguage;
  const availableLocales = await getAvailableTranslationLocales(site, article);

  if (hasMeaningfulTranslation(translation)) {
    return {
      ...article,
      locale,
      originalLocale,
      detectedLanguage,
      availableLocales,
      translationState: locale === originalLocale ? "original" : "translated",
      title: translation.title ?? article.title,
      summary: translation.summary ?? article.summary,
      excerpt: translation.excerpt ?? article.excerpt,
      bodyText: translation.bodyText ?? article.bodyText,
      markdown: translation.markdown ?? article.markdown,
      description: translation.description ?? article.summary ?? article.excerpt,
    };
  }

  return {
    ...article,
    locale,
    originalLocale,
    detectedLanguage,
    availableLocales,
    translationState: locale === originalLocale ? "original" : "untranslated",
    description: article.summary ?? article.excerpt,
  };
}

export function localeLabel(locale) {
  switch (locale) {
    case "de":
      return "Deutsch";
    case "en":
      return "English";
    default:
      return locale.toUpperCase();
  }
}
