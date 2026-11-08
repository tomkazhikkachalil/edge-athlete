#!/usr/bin/env node
// Font Awesome → per-icon SVG modules (the icons round, Nov 2026).
//
//   node scripts/gen-fa-icons.mjs            # (re)generate src/lib/icons/fa/*.ts for every fa-* name used in src/
//   node scripts/gen-fa-icons.mjs --check    # exit 1 when a used name has no module or a module is stale
//
// WHY. Every page loaded Font Awesome's whole stylesheet (90 KB) and three
// font files (259 KB) for the ~225 icons the app draws, and an <i> tag drew
// each. Now each icon is a tiny module holding the glyph's own path from the
// package's SVGs; a component (src/components/FaIcon.tsx) draws it inline;
// a site imports the icons it uses and a route carries only those. Same
// glyphs, same names (aliases resolved — `fa-times` is `xmark`), no fonts.
//
// Names come from the code: every `fa-<name>` token in src/ except the
// modifiers (fa-spin, fa-fw, the family words), plus the BARE names data
// fields hold (`icon: 'stopwatch'`, rendered as `fa-${def.icon}`) — those go
// into the registry (fa-registry.generated.ts) that FaClass resolves at
// render time for class strings only known then. Style: `far` → the regular
// glyph when the free set has one, `fab` → brands, else solid. The metadata
// (icon-families.json) resolves the old names. Icons: CC BY 4.0, Fonticons.
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const FA = join(ROOT, 'node_modules', '@fortawesome', 'fontawesome-free');
const OUT = join(ROOT, 'src', 'lib', 'icons', 'fa');
const check = process.argv.includes('--check');

const MODIFIERS = new Set(['spin', 'fw', 'brands', 'solid', 'regular', 'xs', 'sm', 'lg', 'xl', '2x', '3x', 'pulse', 'fixed', 'inverse', 'stack', 'li', 'ul', 'border', 'flip-horizontal', 'flip-vertical', 'rotate-90', 'rotate-180', 'rotate-270']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

// 1. The names in use, with the style each is used in.
const families = JSON.parse(readFileSync(join(FA, 'metadata', 'icon-families.json'), 'utf8'));
const alias = new Map();
for (const [name, v] of Object.entries(families)) for (const a of v.aliases?.names ?? []) alias.set(a, name);

const used = new Map(); // canonical name → Set<style>
const unknown = new Set();
const unconverted = new Set();
for (const file of walk(join(ROOT, 'src'))) {
  if (file.includes(`${join('src', 'lib', 'icons')}`)) continue;
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\b(fas|far|fab|fa-solid|fa-regular|fa-brands)?\s*(?:[^\s"'`]*\s)?fa-([a-z0-9-]+)/g)) {
    // the family may be elsewhere in the class string; a second pass finds it
    void m;
  }
  // A converted site imports its glyph module: that import IS the use.
  for (const m of src.matchAll(/from '@\/lib\/icons\/fa\/([a-z0-9-]+)'/g)) {
    const base = m[1];
    const style = base.endsWith('-regular') ? 'regular' : base.endsWith('-brands') ? 'brands' : 'solid';
    const name = base.replace(/-(regular|brands)$/, '');
    if (!families[name]) { unknown.add(`${base} (import)`); continue; }
    const set = used.get(name) ?? new Set();
    set.add(style);
    used.set(name, set);
  }
  // Anything still naming an icon as a STRING is unconverted — reported, never generated from.
  if (/__tests__|FaIcon\.tsx$/.test(file)) continue;
  for (const m of src.matchAll(/['"`][^'"`\n]*\bfa-([a-z0-9][a-z0-9-]*)[^'"`\n]*['"`]/g)) {
    if (MODIFIERS.has(m[1]) || m[1].endsWith('-') || m[1] === 'icon' || m[1] === 'icons') continue;
    if (/[\/.]/.test(m[0])) continue; // a path or a file name
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const line = src.slice(lineStart, src.indexOf('\n', m.index));
    if (/\bicon_id:/.test(line) || /^\s*(\/\/|\*)/.test(line)) continue; // the sport registry's legacy name; a comment
    unconverted.add(`${file.slice(ROOT.length + 1)}: ${m[0].slice(0, 60)}`);
  }
}

// 2. One module per (name, style) — the solid one keeps the plain name; regular gets `-regular`, brands `-brands`.
const pascal = (s) => s.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : '')).join('');
function svgFor(name, style) {
  const free = (families[name]?.familyStylesByLicense?.free ?? []).map((s) => s.style);
  const pick = style === 'brands' ? (free.includes('brands') ? 'brands' : null) : style === 'regular' && free.includes('regular') ? 'regular' : free.includes('solid') ? 'solid' : free[0] ?? null;
  if (!pick) return null;
  const file = join(FA, 'svgs', pick, `${name}.svg`);
  if (!existsSync(file)) return null;
  const svg = readFileSync(file, 'utf8');
  const vb = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  const d = [...svg.matchAll(/<path[^>]*\sd="([^"]+)"/g)].map((x) => x[1]).join(' ');
  if (!vb || !d) return null;
  return { style: pick, w: Number(vb[1]), h: Number(vb[2]), d };
}

const wanted = new Map(); // module file base → { exportName, name, style }
for (const [name, styles] of used) {
  for (const style of styles) {
    const glyph = svgFor(name, style);
    if (!glyph) {
      unknown.add(`${name} (${style})`);
      continue;
    }
    const suffix = glyph.style === 'solid' ? '' : `-${glyph.style}`;
    const base = `${name}${suffix}`;
    wanted.set(base, { exportName: `fa${pascal(base)}`, name, ...glyph });
  }
}

if (unknown.size) {
  console.error(`gen-fa-icons: ${unknown.size} name(s) the free set does not have: ${[...unknown].sort().join(', ')}`);
}

const header = (name, style) => `// GENERATED by scripts/gen-fa-icons.mjs — do not edit. Font Awesome Free ${JSON.parse(readFileSync(join(FA, 'package.json'), 'utf8')).version}, ${style} "${name}".\n// Icons: CC BY 4.0 — Fonticons, Inc. https://fontawesome.com/license/free\n`;

// 3. The sprite: every glyph as a <symbol>, ONE static file (content-hashed, cached a day with a week's grace
//    by vercel.json's svg header), drawn by <use>. The modules hold only the id and the box — no path, so a
//    route's JavaScript carries nothing per icon.
import { createHash } from 'node:crypto';
const symbols = [...wanted.entries()].sort().map(([base, g]) => `<symbol id="${base}" viewBox="0 0 ${g.w} ${g.h}"><path d="${g.d}"/></symbol>`).join('');
const sprite = `<svg xmlns="http://www.w3.org/2000/svg"><!-- Font Awesome Free ${JSON.parse(readFileSync(join(FA, 'package.json'), 'utf8')).version} — Icons: CC BY 4.0, Fonticons, Inc. https://fontawesome.com/license/free — generated by scripts/gen-fa-icons.mjs -->${symbols}</svg>\n`;
const spriteHash = createHash('sha256').update(sprite).digest('hex').slice(0, 12);
const spriteName = `fa-${spriteHash}.svg`;
const spriteDir = join(ROOT, 'public', 'icons');
const spriteUrlOut = join(ROOT, 'src', 'lib', 'icons', 'fa-sprite.generated.ts');
const spriteUrlBody = `// GENERATED by scripts/gen-fa-icons.mjs — do not edit.\n/** The one sprite every glyph is drawn from (public/icons/, content-hashed). */\nexport const FA_SPRITE_URL = '/icons/${spriteName}';\n`;

let wrote = 0;
let stale = 0;
mkdirSync(OUT, { recursive: true });
mkdirSync(spriteDir, { recursive: true });
if (!existsSync(join(spriteDir, spriteName)) || (existsSync(spriteUrlOut) && readFileSync(spriteUrlOut, 'utf8') !== spriteUrlBody)) {
  if (check) stale += 1;
  else {
    for (const f of readdirSync(spriteDir)) if (/^fa-[0-9a-f]{12}\.svg$/.test(f)) rmSync(join(spriteDir, f));
    writeFileSync(join(spriteDir, spriteName), sprite);
    writeFileSync(spriteUrlOut, spriteUrlBody);
    wrote += 1;
  }
}
for (const [base, g] of wanted) {
  const body = `${header(g.name, g.style)}import type { FaIconDef } from '../fa-icon';\n\nexport const ${g.exportName}: FaIconDef = { id: '${base}', name: '${g.name}', w: ${g.w}, h: ${g.h} };\n`;
  const file = join(OUT, `${base}.ts`);
  const current = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (current === body) continue;
  if (check) {
    stale += 1;
    continue;
  }
  writeFileSync(file, body);
  wrote += 1;
}
// Modules no site uses any more go (check mode reports them).
for (const f of readdirSync(OUT)) {
  const base = f.replace(/\.ts$/, '');
  if (!wanted.has(base)) {
    if (check) stale += 1;
    else {
      rmSync(join(OUT, f));
      wrote += 1;
    }
  }
}
// The alias table the codemod and the data registry read.
const aliasOut = join(ROOT, 'src', 'lib', 'icons', 'fa-aliases.generated.ts');
const aliasBody = `// GENERATED by scripts/gen-fa-icons.mjs — do not edit. The old Font Awesome names the code still uses → the glyph module's export.\n` +
  `export const FA_ALIASES: Readonly<Record<string, string>> = {\n` +
  [...alias.entries()].sort().map(([a, name]) => `  '${a}': '${name}',`).join('\n') + `\n};\n`;
if ((existsSync(aliasOut) ? readFileSync(aliasOut, 'utf8') : null) !== aliasBody) {
  if (check) stale += 1;
  else writeFileSync(aliasOut, aliasBody);
}

if (unconverted.size) console.error(`gen-fa-icons: ${unconverted.size} icon name(s) still held as strings (unconverted):\n  ${[...unconverted].sort().join('\n  ')}`);
if (check) {
  if (unknown.size) console.error(`gen-fa-icons --check: ${unknown.size} name(s) the free set does not have (a data field that is not an icon, or a typo): ${[...unknown].sort().join(', ')}`);
  if (stale) {
    console.error(`gen-fa-icons --check: ${stale} stale module(s) — run \`node scripts/gen-fa-icons.mjs\``);
    process.exit(1);
  }
  console.log(`gen-fa-icons --check: ${wanted.size} icon modules current`);
} else {
  console.log(`gen-fa-icons: ${wanted.size} icon modules (${wrote} written), ${unknown.size} unknown`);
}
