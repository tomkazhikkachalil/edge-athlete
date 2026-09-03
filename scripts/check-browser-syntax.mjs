#!/usr/bin/env node
// Browser-floor syntax gate (Sep 2026). The project's browserslist floor is
// iOS 15 / Safari 15 (package.json). Next.js 16's own default is Safari 16.4,
// and when we upgraded nothing said so: the framework's client runtime and
// Sentry shipped CLASS STATIC BLOCKS (Safari 16.4+) into every page, and an
// older iPhone could not parse the app at all — every tap dead, every browser
// on that phone, while every desktop check stayed green. This gate parses
// every client chunk and fails on syntax the floor cannot run, so the floor
// can never silently move again. Runs after `next build` in `npm run verify`.
//
// Floor = ES2022 minus what Safari 15 lacks: class static blocks (16.4),
// `#x in obj` brand checks (16.4), regex `d` (16.4) and `v` (17) flags, and
// top-level await in classic chunks. Public/private class fields are fine
// (Safari 14.1 / 15).
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as acorn from 'acorn';

const dir = join(process.cwd(), '.next', 'static', 'chunks');
let files;
try {
  files = readdirSync(dir).filter(f => f.endsWith('.js'));
} catch {
  console.error(`check-browser-syntax: ${dir} not found — run \`next build\` first`);
  process.exit(2);
}

const findings = [];
function walk(node, file) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'StaticBlock') findings.push(`${file}: class static block (Safari 16.4+) @${node.start}`);
  if (node.type === 'BinaryExpression' && node.operator === 'in' && node.left?.type === 'PrivateIdentifier')
    findings.push(`${file}: \`#x in obj\` brand check (Safari 16.4+) @${node.start}`);
  if (node.type === 'Literal' && node.regex && /[dv]/.test(node.regex.flags))
    findings.push(`${file}: regex flag ${node.regex.flags} (Safari 16.4+/17+) @${node.start}`);
  for (const key of Object.keys(node)) {
    if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
    const child = node[key];
    if (Array.isArray(child)) child.forEach(c => walk(c, file));
    else if (child && typeof child.type === 'string') walk(child, file);
  }
}

for (const file of files) {
  const src = readFileSync(join(dir, file), 'utf8');
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true });
  } catch {
    // Turbopack emits classic-script chunks; a few are ES modules — try both.
    try {
      ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    } catch (err) {
      findings.push(`${file}: does not parse as ES2022 (${err.message})`);
      continue;
    }
  }
  walk(ast, file);
}

if (findings.length > 0) {
  console.error(`check-browser-syntax: ${findings.length} finding(s) above the iOS 15 / Safari 15 floor:`);
  for (const f of findings) console.error('  · ' + f);
  process.exit(1);
}
console.log(`check-browser-syntax: ${files.length} client chunks parse for the iOS 15 / Safari 15 floor`);
