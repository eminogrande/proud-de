import { spawn } from "node:child_process";
import path from "node:path";
import { ensureWorkspace, PROJECT_ROOT, resolveCliOption } from "../src/lib/config.mjs";
import { loadLocalEnv } from "../src/lib/env.mjs";

function hasFlag(args, flagName) {
  return args.includes(flagName);
}

function parseLocales(value, site) {
  const raw = String(value ?? "").trim();
  if (!raw) {
    return [];
  }

  if (raw === "all") {
    return [...new Set(site.locales ?? [])].filter((locale) => locale !== site.defaultLocale);
  }

  return [...new Set(raw.split(",").map((entry) => entry.trim()).filter(Boolean))];
}

async function runNodeScript(scriptName, args, env) {
  const display = ["node", scriptName, ...args].join(" ");
  console.log(`\n> ${display}`);

  await new Promise((resolve, reject) => {
    const child = spawn("node", [scriptName, ...args], {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${scriptName} fehlgeschlagen mit Exit-Code ${code}`));
    });

    child.on("error", reject);
  });
}

async function main() {
  const localEnv = await loadLocalEnv(PROJECT_ROOT);
  const env = {
    ...localEnv,
    ...process.env,
  };
  const site = await ensureWorkspace();
  const args = process.argv.slice(2);
  const inputDir = resolveCliOption(args, "--input-dir");
  const translateOption = resolveCliOption(args, "--translate");
  const translateLocales = parseLocales(translateOption, site);
  const magazineSlug = resolveCliOption(args, "--magazine");
  const refreshTranslations = hasFlag(args, "--refresh-translations");
  const skipIngest = hasFlag(args, "--skip-ingest");
  const skipBuild = hasFlag(args, "--skip-build");

  if (!skipIngest) {
    const ingestArgs = [];
    if (inputDir) {
      ingestArgs.push("--input-dir", path.resolve(inputDir));
    }

    await runNodeScript("scripts/ingest.mjs", ingestArgs, env);
  }

  for (const locale of translateLocales) {
    const translateArgs = ["--locale", locale];
    if (magazineSlug) {
      translateArgs.push("--magazine", magazineSlug);
    }
    if (refreshTranslations) {
      translateArgs.push("--refresh", "1");
    }

    await runNodeScript("scripts/translate-articles.mjs", translateArgs, env);
  }

  if (!skipBuild) {
    await runNodeScript("scripts/build-site.mjs", [], env);
  }

  console.log("\nproud generate complete.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
