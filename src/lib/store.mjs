import fs from "node:fs/promises";
import path from "node:path";
import { loadSiteConfig } from "./config.mjs";

export function emptyLibrary(site) {
  return {
    schemaVersion: 1,
    site: {
      title: site.siteTitle,
      domain: site.domain,
      description: site.description,
      language: site.language,
    },
    generatedAt: null,
    magazines: [],
    articles: [],
    stats: {
      magazineCount: 0,
      articleCount: 0,
      wordCount: 0,
    },
  };
}

export async function loadLibrary() {
  const site = await loadSiteConfig();
  const libraryPath = path.join(site.paths.outputDir, "library.json");

  try {
    const raw = await fs.readFile(libraryPath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") {
      return emptyLibrary(site);
    }

    throw error;
  }
}

export async function loadArticleBySlug(slug) {
  const library = await loadLibrary();
  const article = library.articles.find((entry) => entry.slug === slug);
  if (!article) {
    return null;
  }

  const site = await loadSiteConfig();
  const articlePath = path.join(site.paths.outputDir, article.file);
  const raw = await fs.readFile(articlePath, "utf8");
  return JSON.parse(raw);
}

export async function loadMagazineBySlug(slug) {
  const library = await loadLibrary();
  const magazine = library.magazines.find((entry) => entry.slug === slug);
  if (!magazine) {
    return null;
  }

  const site = await loadSiteConfig();
  const magazinePath = path.join(site.paths.outputDir, magazine.file);
  const raw = await fs.readFile(magazinePath, "utf8");
  return JSON.parse(raw);
}

export function sortArticles(articles) {
  return [...articles].sort((left, right) => {
    if (left.publicationDate && right.publicationDate) {
      return left.publicationDate < right.publicationDate ? 1 : -1;
    }

    return left.title.localeCompare(right.title, "de");
  });
}
