import fs from 'fs';
import path from 'path';

const root = path.resolve('recovered/extracted-all');
const outDir = path.resolve('backend/src');
const wsOutDir = path.resolve('backend-ws/src');
const projectSources = new Map();
const wsSources = new Map();

function collectFromDir(extractDir, targetMap, servicePrefix) {
  if (!fs.existsSync(extractDir)) return;
  for (const entry of fs.readdirSync(extractDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    walkMaps(path.join(extractDir, entry.name), targetMap, servicePrefix);
  }
}

function walkMaps(dir, targetMap, servicePrefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkMaps(full, targetMap, servicePrefix);
      continue;
    }
    if (!entry.name.endsWith('.js.map')) continue;
    const map = JSON.parse(fs.readFileSync(full, 'utf8'));
    map.sources?.forEach((source, index) => {
      const normalized = source.replace(/\\/g, '/');
      if (normalized.includes('node_modules')) return;
      if (!/\.(ts|tsx|js|json)$/.test(normalized)) return;
      const rel = normalized.replace(/^(\.\.\/)+/, '');
      if (!rel.startsWith('src/')) return;
      const content = map.sourcesContent?.[index];
      if (!content) return;
      const key = `${servicePrefix}/${rel}`;
      if (!targetMap.has(key)) targetMap.set(key, content);
    });
  }
}

collectFromDir(root, projectSources, 'api');
// WS zips use same backend structure potentially - check ws folder names
for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  if (entry.name.startsWith('ws') || entry.name === 'syncMapData' || entry.name === 'listMaps' && fs.existsSync(path.join(root, entry.name, 'src', 'handlers', 'ws-connect.js'))) {
    walkMaps(path.join(root, entry.name), wsSources, 'ws');
  }
}

function writeSources(targetMap, baseOut, filterPrefix) {
  let count = 0;
  for (const [key, content] of targetMap) {
    if (filterPrefix && !key.startsWith(filterPrefix + '/')) continue;
    const rel = key.replace(/^(api|ws)\//, '');
    const filePath = path.join(baseOut, rel);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
    count++;
  }
  return count;
}

// Re-collect: tag api vs ws by checking which zips are ws
const apiZips = fs.readdirSync(root).filter((n) =>
  !['wsConnect', 'wsDisconnect', 'wsDefault', 'syncMapData', 'requestFullSync'].includes(n)
);
const wsZips = ['wsConnect', 'wsDisconnect', 'wsDefault', 'syncMapData', 'requestFullSync'];

projectSources.clear();
wsSources.clear();

for (const name of apiZips) {
  walkMaps(path.join(root, name), projectSources, 'api');
}
for (const name of wsZips) {
  if (fs.existsSync(path.join(root, name))) {
    walkMaps(path.join(root, name), wsSources, 'ws');
  }
}

const apiCount = writeSources(projectSources, outDir, 'api');
const wsCount = writeSources(wsSources, path.resolve('backend-ws/src'), 'ws');

console.log(JSON.stringify({
  apiFiles: apiCount,
  wsFiles: wsCount,
  apiList: [...projectSources.keys()].filter((k) => k.startsWith('api/')).sort(),
  wsList: [...wsSources.keys()].filter((k) => k.startsWith('ws/')).sort(),
}, null, 2));
