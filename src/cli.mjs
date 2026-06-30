import { loadSiteConfig, relativeToProject } from "./lib/config.mjs";
import { searchArticles } from "./lib/search.mjs";
import {
  loadArticleBySlug,
  loadLibrary,
  loadMagazineBySlug,
  sortArticles,
} from "./lib/store.mjs";

function printHelp() {
  console.log(`proud archive CLI

Usage:
  npm run cli -- status
  npm run cli -- magazines
  npm run cli -- articles [magazine-slug]
  npm run cli -- search <query>
  npm run cli -- show <article-slug>
  npm run cli -- magazine <magazine-slug>
  npm run cli -- export <article-slug> [markdown|json]

Options:
  --json   Ausgabe als JSON`);
}

function parseArgs(argv) {
  const json = argv.includes("--json");
  return {
    json,
    args: argv.filter((value) => value !== "--json"),
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function articleLabel(article) {
  const parts = [article.slug];
  if (article.magazineTitle) {
    parts.push(article.magazineTitle);
  }
  if (article.pages?.start && article.pages?.end) {
    parts.push(`S. ${article.pages.start}-${article.pages.end}`);
  }
  return parts.join(" | ");
}

async function handleStatus(json) {
  const site = await loadSiteConfig();
  const library = await loadLibrary();

  const payload = {
    site: site.siteTitle,
    domain: site.domain,
    generatedAt: library.generatedAt,
    stats: library.stats,
    paths: {
      pdfInputDir: relativeToProject(site.paths.pdfInputDir),
      manifestDir: relativeToProject(site.paths.manifestDir),
      outputDir: relativeToProject(site.paths.outputDir),
    },
  };

  if (json) {
    printJson(payload);
    return;
  }

  console.log(`${site.siteTitle} (${site.domain})`);
  console.log(`PDF input: ${payload.paths.pdfInputDir}`);
  console.log(`Manifests: ${payload.paths.manifestDir}`);
  console.log(`Output: ${payload.paths.outputDir}`);
  console.log(`Magazines: ${library.stats.magazineCount}`);
  console.log(`Articles: ${library.stats.articleCount}`);
  console.log(`Words: ${library.stats.wordCount}`);
  console.log(`Generated: ${library.generatedAt ?? "noch nicht erzeugt"}`);
}

async function handleMagazines(json) {
  const library = await loadLibrary();

  if (json) {
    printJson(library.magazines);
    return;
  }

  if (library.magazines.length === 0) {
    console.log("Keine Magazine gefunden. Führe zuerst `npm run ingest` aus.");
    return;
  }

  for (const magazine of library.magazines) {
    console.log(`${magazine.slug}`);
    console.log(`  ${magazine.title}`);
    console.log(`  Artikel: ${magazine.articleCount} | Quelle: ${magazine.sourcePdf}`);
  }
}

async function handleArticles(magazineSlug, json) {
  const library = await loadLibrary();
  const articles = sortArticles(
    magazineSlug
      ? library.articles.filter((article) => article.magazineSlug === magazineSlug)
      : library.articles,
  );

  if (json) {
    printJson(articles);
    return;
  }

  if (articles.length === 0) {
    console.log("Keine Artikel gefunden.");
    return;
  }

  for (const article of articles) {
    console.log(article.title);
    console.log(`  ${articleLabel(article)}`);
    if (article.authors?.length) {
      console.log(`  Autor:innen: ${article.authors.join(", ")}`);
    }
  }
}

async function handleSearch(query, json) {
  const library = await loadLibrary();
  const results = searchArticles(library, query, { limit: 12 });

  if (json) {
    printJson(results);
    return;
  }

  if (results.length === 0) {
    console.log(`Keine Treffer für "${query}".`);
    return;
  }

  for (const result of results) {
    console.log(`${result.article.title} [${result.score}]`);
    console.log(`  ${articleLabel(result.article)}`);
    console.log(`  ${result.snippet}`);
  }
}

async function handleShow(slug, json) {
  const article = await loadArticleBySlug(slug);
  if (!article) {
    console.error(`Artikel nicht gefunden: ${slug}`);
    process.exitCode = 1;
    return;
  }

  if (json) {
    printJson(article);
    return;
  }

  console.log(article.markdown);
}

async function handleMagazine(slug, json) {
  const magazine = await loadMagazineBySlug(slug);
  if (!magazine) {
    console.error(`Magazin nicht gefunden: ${slug}`);
    process.exitCode = 1;
    return;
  }

  if (json) {
    printJson(magazine);
    return;
  }

  console.log(`${magazine.title}`);
  console.log(`Slug: ${magazine.slug}`);
  console.log(`Quelle: ${magazine.sourcePdf}`);
  console.log(`Seiten: ${magazine.pageCount}`);
  console.log(`Artikel: ${magazine.articleCount}`);
  if (magazine.publicationDate) {
    console.log(`Erscheinung: ${magazine.publicationDate}`);
  }
  for (const article of magazine.articles) {
    console.log(`- ${article.title} (${article.slug})`);
  }
}

async function handleExport(slug, format) {
  const article = await loadArticleBySlug(slug);
  if (!article) {
    console.error(`Artikel nicht gefunden: ${slug}`);
    process.exitCode = 1;
    return;
  }

  if (format === "json") {
    printJson(article);
    return;
  }

  console.log(article.markdown);
}

async function main() {
  const { json, args } = parseArgs(process.argv.slice(2));
  const [command, ...rest] = args;

  switch (command) {
    case undefined:
    case "help":
    case "--help":
      printHelp();
      return;
    case "status":
      await handleStatus(json);
      return;
    case "magazines":
      await handleMagazines(json);
      return;
    case "articles":
      await handleArticles(rest[0] ?? null, json);
      return;
    case "search":
      await handleSearch(rest.join(" "), json);
      return;
    case "show":
      await handleShow(rest[0], json);
      return;
    case "magazine":
      await handleMagazine(rest[0], json);
      return;
    case "export":
      await handleExport(rest[0], rest[1] ?? "markdown");
      return;
    default:
      printHelp();
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
