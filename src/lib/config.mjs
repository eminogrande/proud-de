import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function resolveProjectPath(relativePath) {
  return path.resolve(PROJECT_ROOT, relativePath);
}

export async function loadSiteConfig() {
  const configPath = resolveProjectPath("config/site.json");
  const raw = await fs.readFile(configPath, "utf8");
  const config = JSON.parse(raw);

  const resolvedPaths = {
    pdfInputDir: resolveProjectPath(config.paths?.pdfInputDir ?? "data/input/pdfs"),
    manifestDir: resolveProjectPath(config.paths?.manifestDir ?? "data/input/manifests"),
    enrichmentDir: resolveProjectPath(config.paths?.enrichmentDir ?? "data/input/enrichments"),
    translationDir: resolveProjectPath(config.paths?.translationDir ?? "data/input/translations"),
    outputDir: resolveProjectPath(config.paths?.outputDir ?? "data/output"),
    siteOutputDir: resolveProjectPath(config.paths?.siteOutputDir ?? "site"),
  };

  return {
    ...config,
    domain: process.env.PROUD_PUBLIC_DOMAIN ?? config.domain,
    configPath,
    drive: {
      remote: process.env.PROUD_DRIVE_REMOTE ?? config.drive?.remote ?? null,
      path: process.env.PROUD_DRIVE_PATH ?? config.drive?.path ?? "",
    },
    paths: resolvedPaths,
  };
}

export async function ensureWorkspace() {
  const site = await loadSiteConfig();
  await fs.mkdir(site.paths.pdfInputDir, { recursive: true });
  await fs.mkdir(site.paths.manifestDir, { recursive: true });
  await fs.mkdir(site.paths.enrichmentDir, { recursive: true });
  await fs.mkdir(site.paths.translationDir, { recursive: true });
  await fs.mkdir(site.paths.outputDir, { recursive: true });
  await fs.mkdir(site.paths.siteOutputDir, { recursive: true });
  await fs.mkdir(path.join(site.paths.outputDir, "articles"), { recursive: true });
  await fs.mkdir(path.join(site.paths.outputDir, "magazines"), { recursive: true });
  await fs.mkdir(path.join(site.paths.outputDir, "previews"), { recursive: true });
  await fs.mkdir(path.join(site.paths.outputDir, "drafts"), { recursive: true });
  return site;
}

export function resolveCliOption(args, flagName) {
  const index = args.indexOf(flagName);
  if (index === -1) {
    return null;
  }

  return args[index + 1] ?? null;
}

export function relativeToProject(absolutePath) {
  return path.relative(PROJECT_ROOT, absolutePath);
}
