import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { ensureWorkspace, PROJECT_ROOT, resolveCliOption } from "../src/lib/config.mjs";
import { loadLocalEnv } from "../src/lib/env.mjs";

function resolvePythonBinary(projectRoot) {
  return path.join(projectRoot, ".venv", "bin", "python");
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const site = await ensureWorkspace();
  const localEnv = await loadLocalEnv(PROJECT_ROOT);
  const args = process.argv.slice(2);
  const explicitInputDir = resolveCliOption(args, "--input-dir");
  const inputDir = explicitInputDir ? path.resolve(explicitInputDir) : site.paths.pdfInputDir;
  const pythonBinary = resolvePythonBinary(PROJECT_ROOT);
  const python = (await exists(pythonBinary)) ? pythonBinary : "python3";
  const scriptPath = path.join(PROJECT_ROOT, "scripts", "pdf_extract.py");

  const childArgs = [
    "-u",
    scriptPath,
    "--site-config",
    site.configPath,
    "--input-dir",
    inputDir,
    "--manifest-dir",
    site.paths.manifestDir,
    "--output-dir",
    site.paths.outputDir,
  ];

  await new Promise((resolve, reject) => {
    const child = spawn(python, childArgs, {
      cwd: process.cwd(),
      env: {
        ...localEnv,
        ...process.env,
        PYTHONUNBUFFERED: "1",
      },
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Ingestion fehlgeschlagen mit Exit-Code ${code}`));
    });

    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
