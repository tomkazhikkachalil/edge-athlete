#!/usr/bin/env node
// Pass 2 of the icons round: icon NAMES in data become glyph OBJECTS, and the
// sites that drew them through FaClass draw them through FaIcon — so every
// page carries exactly the glyphs its data names, and no registry.
//
//   node scripts/codemod-fa-defs.mjs [--dry]
//
//   definitions   icon: 'fa-x' / icon: 'fas fa-x' / icon: 'x' (a bare FA name)  → icon: faX   (+ import)
//                 icon_id: 'fas fa-x'  (the sport registry) → keeps icon_id, ADDS icon: faX
//   render sites  <FaClass className={`fas ${EXPR} REST`} … />  → <FaIcon icon={EXPR} className="REST" … />
//                 <FaClass className={EXPR} />, {`${EXPR} REST`}, with `EXPR ?? 'fas fa-x'` → `EXPR ?? faX`,
//                 and `.icon_id` → `.icon`. EXPR may be a path, a call or an index — never a literal.
// Everything else is reported for a hand. The type declarations (`icon: string` → `icon: FaIconDef`)
// are a hand's job too; tsc names them.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');
const aliasSrc = readFileSync(join(ROOT, 'src/lib/icons/fa-aliases.generated.ts'), 'utf8');
const ALIASES = Object.fromEntries([...aliasSrc.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]));
const families = JSON.parse(readFileSync(join(ROOT, 'node_modules/@fortawesome/fontawesome-free/metadata/icon-families.json'), 'utf8'));
const pascal = (s) => s.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : '')).join('');
const SKIP = [join('src', 'lib', 'icons'), join('lib', 'play', 'badges'), join('components', 'play'), '__tests__'];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}
/** 'fas fa-x' | 'fa-x' | 'x' → { base, exportName } or null. */
function glyphFor(literal) {
  const toks = literal.trim().split(/\s+/);
  let family = 'solid';
  let name = null;
  for (const t of toks) {
    if (t === 'far' || t === 'fa-regular') family = 'regular';
    else if (t === 'fab' || t === 'fa-brands') family = 'brands';
    else if (t === 'fas' || t === 'fa-solid' || t === 'fa') continue;
    else if (/^fa-[a-z0-9][a-z0-9-]*$/.test(t)) name = t.slice(3);
    else if (toks.length === 1 && /^[a-z0-9][a-z0-9-]*$/.test(t)) name = t;
    else return null; // a class string with other classes — not a pure icon literal
  }
  if (!name) return null;
  const canonical = ALIASES[name] ?? name;
  if (!families[canonical]) return null;
  const base = family === 'solid' ? canonical : `${canonical}-${family}`;
  const file = join(ROOT, 'src/lib/icons/fa', `${base}.ts`);
  const moduleBase = existsSync(file) ? base : canonical;
  return { moduleBase, exportName: `fa${pascal(moduleBase)}` };
}

const report = { defs: 0, sportDefs: 0, sites: 0, left: [] };
let changedFiles = 0;
for (const file of walk(join(ROOT, 'src'))) {
  if (SKIP.some((s) => file.includes(s))) continue;
  const original = readFileSync(file, 'utf8');
  let src = original;
  const used = new Set();
  const left = [];

  // Definitions.
  src = src.replace(/\bicon_id:\s*'([^']+)',?/g, (whole, lit) => {
    const g = glyphFor(lit);
    if (!g) return whole;
    used.add(g.moduleBase);
    report.sportDefs += 1;
    return `${whole.endsWith(',') ? whole : whole + ','} icon: ${g.exportName},`;
  });
  src = src.replace(/\bicon:\s*'([^']+)'/g, (whole, lit) => {
    const g = glyphFor(lit);
    if (!g) {
      if (/fa-|^[a-z-]+$/.test(lit) && !/^(text-|bg-)/.test(lit)) left.push(`${file.slice(ROOT.length + 1)}: ${whole}`);
      return whole;
    }
    used.add(g.moduleBase);
    report.defs += 1;
    return `icon: ${g.exportName}`;
  });

  // Render sites: FaClass with a class string built from an expression.
  const EXPR = String.raw`[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*|\[[^\]]+\]|\([^()]*\))*`;
  const fallback = String.raw`(?:\s*\?\?\s*'((?:fa[srb]\s+)?fa-[a-z0-9-]+)')?`;
  const siteRe = new RegExp(String.raw`<FaClass className=\{(?:\x60(?:fas|far|fab)?\s*\$\{(${EXPR})${fallback}\}((?:\s+[A-Za-z0-9:\[\]./%()-]+)*)\s*\x60|(${EXPR})${fallback})\}`, 'g');
  src = src.replace(siteRe, (whole, expr1, fb1, rest, expr2, fb2) => {
    const expr = (expr1 ?? expr2).replace(/\.icon_id\b/g, '.icon');
    const fb = fb1 ?? fb2;
    let iconExpr = expr;
    if (fb) {
      const g = glyphFor(fb);
      if (!g) { left.push(`${file.slice(ROOT.length + 1)}: ${whole}`); return whole; }
      used.add(g.moduleBase);
      iconExpr = `${expr} ?? ${g.exportName}`;
    }
    report.sites += 1;
    const classes = (rest ?? '').trim();
    return `<FaIcon icon={${iconExpr}}${classes ? ` className="${classes}"` : ''}`;
  });
  for (const m of src.matchAll(/<FaClass className=\{[^\n]*/g)) left.push(`${file.slice(ROOT.length + 1)}: ${m[0].slice(0, 140)}`);

  if (left.length) report.left.push(...left);
  if (src === original) continue;
  const importLines = [...used].sort().map((b) => `import { fa${pascal(b)} } from '@/lib/icons/fa/${b}';`);
  if (/<FaIcon\b/.test(src) && !/from '@\/components\/FaIcon'/.test(src)) importLines.unshift(`import FaIcon from '@/components/FaIcon';`);
  if (!/<FaClass\b/.test(src)) src = src.replace(/^import FaClass from '@\/components\/FaClass';\n/m, '');
  let lastEnd = 0;
  for (const m of src.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm)) lastEnd = m.index + m[0].length;
  if (lastEnd === 0) {
    const m = /^['"]use client['"];?\n/.exec(src);
    lastEnd = m ? m[0].length : 0;
    src = src.slice(0, lastEnd) + importLines.join('\n') + '\n' + src.slice(lastEnd);
  } else if (importLines.length) {
    src = src.slice(0, lastEnd) + '\n' + importLines.join('\n') + src.slice(lastEnd);
  }
  changedFiles += 1;
  if (!dry) writeFileSync(file, src);
}
console.log(`codemod-fa-defs${dry ? ' (dry)' : ''}: definitions ${report.defs} · sport icon_ids ${report.sportDefs} · sites ${report.sites} · files ${changedFiles} · left ${report.left.length}`);
if (report.left.length) {
  writeFileSync(join(ROOT, 'docs/load/2026-11-07/fa-defs-left.txt'), report.left.join('\n') + '\n');
  console.log('  the list: docs/load/2026-11-07/fa-defs-left.txt');
}
