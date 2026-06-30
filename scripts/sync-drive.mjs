import { spawn } from "node:child_process";
import path from "node:path";
import { ensureWorkspace } from "../src/lib/config.mjs";

async function main() {
  const site = await ensureWorkspace();
  const remote = site.drive?.remote;
  const remotePath = site.drive?.path ?? "";

  if (!remote) {
    console.error("Kein Google-Drive-Remote konfiguriert. Setze `drive.remote` in config/site.json.");
    process.exit(1);
  }

  const source = `${remote}:${remotePath}`;
  const destination = site.paths.pdfInputDir;
  const args = [
    "copy",
    source,
    destination,
    "--include",
    "*.pdf",
    "--create-empty-src-dirs",
    "--checksum",
    "--progress",
  ];

  await new Promise((resolve, reject) => {
    const child = spawn("rclone", args, {
      cwd: process.cwd(),
      stdio: "inherit",
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Drive-Sync fehlgeschlagen mit Exit-Code ${code}`));
    });

    child.on("error", reject);
  });

  console.log(`Drive-Sync abgeschlossen: ${source} -> ${path.relative(process.cwd(), destination)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
