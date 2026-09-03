#!/usr/bin/env node
// Browser-floor gate (Sep 2026) — the last step of `npm run verify`. The floor
// is iOS 15 / Safari 15 (package.json browserslist). Next.js 16's own default
// is Safari 16.4, and when we upgraded nothing said so: the framework's client
// runtime and Sentry shipped CLASS STATIC BLOCKS into every page and an older
// iPhone could not parse the app at all (round 5, Sep 3). The same day, round
// 6: with the parse failure fixed, a `toSpliced` in the app header threw on
// every page with the header — valid syntax, missing method. So this gate
// checks BOTH: syntax the floor cannot parse, and runtime members it cannot
// call. The rules and their exemptions live in scripts/browser-floor-rules.mjs
// (unit-tested from src/lib/__tests__/browser-floor-rules.test.ts).
//
// No local old-iOS runtime exists (no simulator on this Mac; Playwright ships
// current WebKit only), so this gate plus the phone are the proof.
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { scanChunkSource } from './browser-floor-rules.mjs';

// Optional argv[2]: a directory of downloaded chunks (e.g. the LIVE deploy's),
// so the same rules can be run against production after a merge.
const dir = process.argv[2] ? resolve(process.argv[2]) : join(process.cwd(), '.next', 'static', 'chunks');
let files;
try {
  files = readdirSync(dir).filter(f => f.endsWith('.js'));
} catch {
  console.error(`check-browser-syntax: ${dir} not found — run \`next build\` first`);
  process.exit(2);
}

const findings = [];
for (const file of files) findings.push(...scanChunkSource(readFileSync(join(dir, file), 'utf8'), file));

if (findings.length > 0) {
  console.error(`check-browser-syntax: ${findings.length} finding(s) above the iOS 15 / Safari 15 floor:`);
  for (const f of findings) console.error('  · ' + f);
  process.exit(1);
}
console.log(`check-browser-syntax: ${files.length} client chunks parse and call within the iOS 15 / Safari 15 floor`);
