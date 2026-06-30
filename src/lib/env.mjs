import fs from "node:fs/promises";
import path from "node:path";

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (
    (trimmed.startsWith("\"") && trimmed.endsWith("\"")) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

export async function loadLocalEnv(projectRoot) {
  const result = {};
  const candidates = [".env.local", ".env"].map((name) => path.join(projectRoot, name));

  for (const filePath of candidates) {
    let content = "";
    try {
      content = await fs.readFile(filePath, "utf8");
    } catch {
      continue;
    }

    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        continue;
      }

      const separatorIndex = line.indexOf("=");
      if (separatorIndex <= 0) {
        continue;
      }

      const key = line.slice(0, separatorIndex).trim();
      if (!key || key in result) {
        continue;
      }

      result[key] = parseEnvValue(line.slice(separatorIndex + 1));
    }
  }

  return result;
}
