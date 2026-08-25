import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = process.cwd();
const sourceRoots = ["apps", "packages", "scripts", "tests"];
const sourceExtensions = new Set([".css", ".mjs", ".ts", ".tsx"]);
const excludedDirectories = new Set(["coverage", "dist", "node_modules"]);
const warningLimit = 200;
const hardLimit = 300;

async function collectFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (excludedDirectories.has(entry.name)) continue;
    const path = join(directory, entry.name);

    if (entry.isDirectory()) files.push(...(await collectFiles(path)));
    if (entry.isFile() && sourceExtensions.has(extname(entry.name)))
      files.push(path);
  }

  return files;
}

const files = (
  await Promise.all(
    sourceRoots.map((directory) => collectFiles(join(root, directory))),
  )
).flat();
const warnings = [];
const failures = [];

for (const file of files) {
  const lineCount = (await readFile(file, "utf8")).split("\n").length;
  const result = `${relative(root, file)} has ${lineCount} lines`;

  if (lineCount > hardLimit) failures.push(result);
  else if (lineCount > warningLimit) warnings.push(result);
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);
if (failures.length > 0) {
  for (const failure of failures) console.error(`Error: ${failure}`);
  process.exitCode = 1;
}
