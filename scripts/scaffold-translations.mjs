import fs from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace } from "../src/lib/config.mjs";
import { detectArticleLanguage } from "../src/lib/i18n.mjs";
import { loadLibrary } from "../src/lib/store.mjs";

async function writeIfMissing(filePath, content) {
  try {
    await fs.access(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf8");
  }
}

async function main() {
  const locale = process.argv[2];
  if (!locale) {
    console.error("Usage: npm run scaffold:translations -- <locale>");
    process.exit(1);
  }

  const site = await ensureWorkspace();
  const library = await loadLibrary();
  let created = 0;

  for (const article of library.articles) {
    const filePath = path.join(site.paths.translationDir, locale, `${article.slug}.json`);
    const payload = {
      locale,
      slug: article.slug,
      sourceTitle: article.title,
      detectedLanguage: detectArticleLanguage(article),
      title: null,
      summary: null,
      excerpt: null,
      bodyText: null,
      markdown: null,
      notes: "Fill only the translated fields you want to override. Null means fallback to the original article.",
    };

    const before = await fs
      .access(filePath)
      .then(() => true)
      .catch((error) => {
        if (error.code === "ENOENT") {
          return false;
        }
        throw error;
      });

    await writeIfMissing(filePath, `${JSON.stringify(payload, null, 2)}\n`);
    if (!before) {
      created += 1;
    }
  }

  console.log(`Translation scaffolds for ${locale}: ${created} new files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
