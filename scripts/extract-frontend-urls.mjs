import fs from 'fs';

const js = fs.readFileSync('recovered/frontend-s3/assets/index-DlE_hMSo.js', 'utf8');
const apis = [...js.matchAll(/https:\/\/[a-z0-9]+\.execute-api\.[^"'`\s]+/g)].map((m) => m[0]);
const ws = [...js.matchAll(/wss:\/\/[a-z0-9]+\.execute-api\.[^"'`\s]+/g)].map((m) => m[0]);
const s3 = [...js.matchAll(/https:\/\/community-profile-app[^"'`\s]*/g)].map((m) => m[0]);
console.log('API URLs:', [...new Set(apis)]);
console.log('WS URLs:', [...new Set(ws)]);
console.log('S3 URLs:', [...new Set(s3)].slice(0, 5));
