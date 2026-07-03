import { spawn } from "node:child_process";
import { PROJECT_ROOT } from "../src/lib/config.mjs";
import { loadLocalEnv } from "../src/lib/env.mjs";

async function main() {
  const localEnv = await loadLocalEnv(PROJECT_ROOT);
  const env = {
    ...localEnv,
    ...process.env,
  };

  if (!env.CLOUDFLARE_API_TOKEN) {
    throw new Error("CLOUDFLARE_API_TOKEN fehlt. Lege ihn lokal in .env.local ab; diese Datei wird nicht committed.");
  }

  await new Promise((resolve, reject) => {
    const child = spawn("wrangler", ["deploy"], {
      cwd: PROJECT_ROOT,
      env,
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`wrangler deploy fehlgeschlagen mit Exit-Code ${code}`));
    });

    child.on("error", reject);
  });
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
