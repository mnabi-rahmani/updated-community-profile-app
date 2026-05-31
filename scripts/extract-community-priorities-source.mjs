import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceIndexPath = path.join(repoRoot, "deployed", "index.html");
const outputDir = path.join(repoRoot, "frontend", "community-priorities-src");
const sourceDir = path.join(outputDir, "src");

const html = fs.readFileSync(sourceIndexPath, "utf8");

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
const bodyMatch = html.match(
  /<body>([\s\S]*?)<script src="cursor_v2_map_data\/photo_backed_priorities\.js"><\/script>/
);
const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (!styleMatch || !bodyMatch || scripts.length === 0) {
  throw new Error(`Could not parse ${sourceIndexPath}`);
}

fs.mkdirSync(sourceDir, { recursive: true });

const indexHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Community Priorities Map</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="src/styles.css">
</head>
<body>
${bodyMatch[1].trimEnd()}
  <script src="cursor_v2_map_data/photo_backed_priorities.js"></script>
  <script src="cursor_v2_map_data/layers_bundle.js"></script>
  <script src="cursor_v2_map_data/photo_index.js"></script>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script src="src/app.js"></script>
</body>
</html>
`;

fs.writeFileSync(path.join(outputDir, "index.html"), indexHtml);
fs.writeFileSync(path.join(sourceDir, "styles.css"), `${styleMatch[1].trim()}\n`);
fs.writeFileSync(path.join(sourceDir, "app.js"), `${scripts.at(-1)[1].trim()}\n`);

console.log(`Wrote Community Priorities source to ${path.relative(repoRoot, outputDir)}`);
