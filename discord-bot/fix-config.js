'use strict';
// One-shot script: strips everything after the first valid JSON object in config.json
const fs = require('fs');
const raw = fs.readFileSync('config.json', 'utf-8');

let depth = 0, end = -1, inStr = false, esc = false;
for (let i = 0; i < raw.length; i++) {
  const c = raw[i];
  if (esc)          { esc = false; continue; }
  if (c === '\\' && inStr) { esc = true; continue; }
  if (c === '"')    { inStr = !inStr; continue; }
  if (inStr)        continue;
  if (c === '{')    depth++;
  else if (c === '}') {
    depth--;
    if (depth === 0) { end = i; break; }
  }
}

if (end === -1) { console.error('Could not find end of first JSON object'); process.exit(1); }

const first = raw.slice(0, end + 1);
JSON.parse(first); // validate
fs.writeFileSync('config.json', first, 'utf-8');
console.log(`Fixed. Kept ${first.length} chars, removed ${raw.length - first.length} chars of appended junk.`);
