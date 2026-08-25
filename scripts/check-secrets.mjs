import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

const root = process.cwd();
const publicRoots = ["apps", "packages", "scripts", "tests", ".github"];
const rootFiles = [
  ".gitignore",
  "package.json",
  "playwright.config.ts",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "tsconfig.base.json",
];
const excludedDirectories = new Set(["coverage", "dist", "node_modules"]);
const forbiddenPaths = [/(^|\/).*private.*\.key$/i];
const secretPatterns = [
  /-----BEGIN (?:EC |OPENSSH |RSA )?PRIVATE KEY-----/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{32,}\b/,
  /\bPRIVATE_KEY\s*[:=]\s*["']?0x[a-fA-F0-9]{64}\b/,
];
const findings = [];

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);

    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    if (entry.isFile()) files.push(path);
  }

  return files;
}

const candidates = [
  ...(
    await Promise.all(
      publicRoots.map((directory) => collectFiles(join(root, directory))),
    )
  ).flat(),
  ...rootFiles.map((path) => join(root, path)),
];

for (const path of candidates) {
  const filename = basename(path);
  const isEnvironmentFile = filename === ".env" || filename.startsWith(".env.");

  if (
    (isEnvironmentFile && filename !== ".env.example") ||
    forbiddenPaths.some((pattern) => pattern.test(path))
  ) {
    findings.push(`${path}: forbidden secret-bearing path`);
    continue;
  }

  try {
    const content = await readFile(path, "utf8");
    if (secretPatterns.some((pattern) => pattern.test(content))) {
      findings.push(`${path}: possible credential`);
    }
  } catch {
    // Binary and transient files are ignored by this text-only scanner.
  }
}

if (findings.length > 0) {
  for (const finding of findings) console.error(finding);
  process.exitCode = 1;
}
