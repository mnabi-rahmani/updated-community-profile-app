import fs from 'fs';

const js = fs.readFileSync('frontend/dist/assets/index-DlE_hMSo.js', 'utf8');
const patterns = [
  /path:"([^"]+)"/g,
  /to:"([^"]+)"/g,
  /"\/cfm[^"]*"/g,
  /CFM Cases/g,
  /Community Priorities/g,
  /clusters_map/g,
  /cfm-cases/g,
];
for (const p of patterns) {
  const matches = [...js.matchAll(p)].map((m) => m[1] ?? m[0]);
  if (matches.length) console.log(p.source, [...new Set(matches)].slice(0, 20));
}
