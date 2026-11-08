#!/usr/bin/env node
// `<i className="fas fa-x …">` → `<FaIcon icon={faX} … />` (the icons round, Nov 2026).
//
//   node scripts/codemod-fa-icons.mjs --dry      # report what it would change and what it leaves
//   node scripts/codemod-fa-icons.mjs            # rewrite the files
//
// Handles the regular shapes and REPORTS the rest for a hand:
//   A  <i className="fas fa-x rest" …></i>   and the self-closing form
//   B  <i className={`fas fa-x rest ${expr}`} …>   (a constant icon, a dynamic rest)
//   C  <i className={`fas ${cond ? 'fa-a' : 'fa-b'} rest`} …>
//   D  <i className={cond ? 'fas fa-a rest' : 'fas fa-b rest2'} …>
// fa-spin → spin, fa-fw → fixedWidth, aria-hidden="true" dropped (the default),
// every other attribute kept. Imports are added per file. Aliases resolve to
// the glyph module (`fa-times` → faXmark) through fa-aliases.generated.ts.
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const dry = process.argv.includes('--dry');
const FAMILY = /^(fas|far|fab|fa-solid|fa-regular|fa-brands|fa)$/;
const aliasSrc = readFileSync(join(ROOT, 'src/lib/icons/fa-aliases.generated.ts'), 'utf8');
const ALIASES = Object.fromEntries([...aliasSrc.matchAll(/'([^']+)': '([^']+)'/g)].map((m) => [m[1], m[2]]));
const pascal = (s) => s.split('-').map((p) => (p ? p[0].toUpperCase() + p.slice(1) : '')).join('');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

/** The class list → { icon module base + export, spin, fixedWidth, rest[] } or null when no fa- icon is in it. */
function parseClasses(tokens, familyHint) {
  let family = familyHint ?? 'solid';
  let name = null;
  let spin = false;
  let fw = false;
  const rest = [];
  for (const t of tokens) {
    if (!t) continue;
    if (FAMILY.test(t)) {
      family = t === 'far' || t === 'fa-regular' ? 'regular' : t === 'fab' || t === 'fa-brands' ? 'brands' : 'solid';
      continue;
    }
    if (t === 'fa-spin') { spin = true; continue; }
    if (t === 'fa-fw') { fw = true; continue; }
    const m = /^fa-([a-z0-9][a-z0-9-]*)$/.exec(t);
    if (m && !name) {
      const canonical = ALIASES[m[1]] ?? m[1];
      name = canonical;
      continue;
    }
    rest.push(t);
  }
  if (!name) return null;
  const base = family === 'solid' ? name : `${name}-${family}`;
  const file = join(ROOT, 'src/lib/icons/fa', `${base}.ts`);
  const moduleBase = existsSync(file) ? base : existsSync(join(ROOT, 'src/lib/icons/fa', `${name}.ts`)) ? name : null;
  if (!moduleBase) return { missing: name };
  return { moduleBase, exportName: `fa${pascal(moduleBase)}`, spin, fw, rest };
}

const ATTR_DROP = /^\s*aria-hidden=(?:"true"|\{true\})\s*$/;
function keepAttrs(attrs) {
  // attrs: the raw attribute text after className=… (may hold aria-hidden, title, onClick, data-*, style…)
  const parts = [];
  const re = /\s+([a-zA-Z-]+)(=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}))?/g;
  for (const m of attrs.matchAll(re)) {
    const whole = m[0];
    if (ATTR_DROP.test(whole)) continue;
    parts.push(whole.trim());
  }
  return parts.length ? ' ' + parts.join(' ') : '';
}

function build(parsed, classExpr, attrs) {
  const props = [`icon={${parsed.exportName}}`];
  if (parsed.spin) props.push('spin');
  if (parsed.fw) props.push('fixedWidth');
  if (classExpr) props.push(`className=${classExpr}`);
  return `<FaIcon ${props.join(' ')}${keepAttrs(attrs)} />`;
}

const report = { A: 0, B: 0, C: 0, D: 0, E: 0, left: [] };
const files = walk(join(ROOT, 'src'));
let changedFiles = 0;
for (const file of files) {
  const original = readFileSync(file, 'utf8');
  let src = original;
  const used = new Set();
  const left = [];
  let usesClass = false;

  // Every <i …className=…>…</i> or <i … /> whose class names hold an fa- icon.
  const tagRe = /<i\b((?:\s+(?!className)[a-zA-Z-]+(?:=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}))?)*)\s+className=("[^"]*"|'[^']*'|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})((?:\s+[a-zA-Z-]+(?:=(?:"[^"]*"|'[^']*'|\{(?:[^{}]|\{[^{}]*\})*\}))?)*)\s*(?:\/>|>\s*<\/i>)/g;
  src = src.replace(tagRe, (whole, before, cls, after) => {
    const attrs = `${before}${after}`;
    if (!/fa-|icon/i.test(cls)) return whole;
    // A: a plain string
    let m = /^["']([^"']*)["']$/.exec(cls);
    if (m) {
      const parsed = parseClasses(m[1].split(/\s+/));
      if (!parsed || parsed.missing) { left.push(whole); return whole; }
      used.add(parsed.moduleBase);
      report.A += 1;
      return build(parsed, parsed.rest.length ? `"${parsed.rest.join(' ')}"` : null, attrs);
    }
    // C: {`fas ${cond ? 'fa-a [classes]' : 'fa-b [classes]'} rest`} — the branches may carry classes (and fa-spin) of their own
    m = /^\{`([^`$]*)\$\{((?:[^?{}]|\([^()]*\))+?)\s*\?\s*'([^']*fa-[^']*)'\s*:\s*'([^']*fa-[^']*)'\}([^`$]*)`\}$/.exec(cls);
    if (m) {
      const shared = `${m[1]} ${m[5]}`.split(/\s+/);
      const a = parseClasses([...shared, ...m[3].split(/\s+/)]);
      const b = parseClasses([...shared, ...m[4].split(/\s+/)]);
      if (!a || a.missing || !b || b.missing) { left.push(whole); return whole; }
      used.add(a.moduleBase); used.add(b.moduleBase);
      report.C += 1;
      const cond = m[2].trim();
      const props = [`icon={${cond} ? ${a.exportName} : ${b.exportName}}`];
      if (a.spin !== b.spin) props.push(`spin={${cond} ? ${a.spin} : ${b.spin}}`);
      else if (a.spin) props.push('spin');
      if (a.fw || b.fw) props.push('fixedWidth');
      const ra = a.rest.join(' '), rb = b.rest.join(' ');
      if (ra === rb) { if (ra) props.push(`className="${ra}"`); }
      else props.push(`className={${cond} ? '${ra}' : '${rb}'}`);
      return `<FaIcon ${props.join(' ')}${keepAttrs(attrs)} />`;
    }
    // D: {cond ? 'fas fa-a rest' : 'fas fa-b rest2'}
    m = /^\{([^?{}]+?)\s*\?\s*'([^']*fa-[^']*)'\s*:\s*'([^']*fa-[^']*)'\}$/.exec(cls);
    if (m) {
      const a = parseClasses(m[2].split(/\s+/));
      const b = parseClasses(m[3].split(/\s+/));
      if (!a || a.missing || !b || b.missing) { left.push(whole); return whole; }
      used.add(a.moduleBase); used.add(b.moduleBase);
      report.D += 1;
      const cond = m[1].trim();
      const props = [`icon={${cond} ? ${a.exportName} : ${b.exportName}}`];
      if (a.spin !== b.spin) props.push(`spin={${cond} ? ${a.spin} : ${b.spin}}`);
      else if (a.spin) props.push('spin');
      if (a.fw || b.fw) props.push('fixedWidth');
      const ra = a.rest.join(' '), rb = b.rest.join(' ');
      if (ra === rb) { if (ra) props.push(`className="${ra}"`); }
      else props.push(`className={${cond} ? '${ra}' : '${rb}'}`);
      return `<FaIcon ${props.join(' ')}${keepAttrs(attrs)} />`;
    }
    // B: {`fas fa-x rest ${expr} …`} — the icon is a literal token somewhere in the template
    m = /^\{`([\s\S]*)`\}$/.exec(cls);
    if (m && !/\$\{[^}]*fa-|fa-\$\{/.test(m[1])) {
      const tpl = m[1];
      // split into literal text and ${…} holes
      const pieces = tpl.split(/(\$\{(?:[^{}]|\{[^{}]*\})*\})/);
      const literalTokens = pieces.filter((p) => !p.startsWith('${')).join(' ').split(/\s+/);
      const parsed = parseClasses(literalTokens);
      if (parsed && !parsed.missing) {
      const holes = pieces.filter((p) => p.startsWith('${'));
      used.add(parsed.moduleBase);
      report.B += 1;
      let classExpr = null;
      if (holes.length === 1 && parsed.rest.length === 0) classExpr = `{${holes[0].slice(2, -1)}}`;
      else if (holes.length === 0) classExpr = parsed.rest.length ? `"${parsed.rest.join(' ')}"` : null;
      else classExpr = `{\`${[...parsed.rest, ...holes].join(' ')}\`}`;
      return build(parsed, classExpr, attrs);
      }
    }
    // E: anything else whose class names come from DATA (`icon_id`, `.icon`, an icon map) or a shape above did not take:
    // FaClass reads the class string at render time through the registry — the <i> read it through the webfont.
    if (/fa-|icon/i.test(cls)) {
      report.E += 1;
      usesClass = true;
      return `<FaClass className=${cls}${keepAttrs(attrs)} />`;
    }
    left.push(whole);
    return whole;
  });

  if (left.length) report.left.push(...left.map((l) => `${file.slice(ROOT.length + 1)}: ${l.replace(/\s+/g, ' ').slice(0, 140)}`));
  if (src === original) continue;
  // Imports: after the last import statement.
  const importLines = [...used].sort().map((b) => `import { fa${pascal(b)} } from '@/lib/icons/fa/${b}';`);
  if (usesClass && !/from '@\/components\/FaClass'/.test(src)) importLines.unshift(`import FaClass from '@/components/FaClass';`);
  if (/<FaIcon\b/.test(src) && !/from '@\/components\/FaIcon'/.test(src)) importLines.unshift(`import FaIcon from '@/components/FaIcon';`);
  let lastEnd = 0;
  for (const m of src.matchAll(/^import[\s\S]*?from\s+['"][^'"]+['"];?[ \t]*$/gm)) lastEnd = m.index + m[0].length;
  if (lastEnd === 0) {
    const m = /^['"]use client['"];?\n/.exec(src);
    lastEnd = m ? m[0].length : 0;
    src = src.slice(0, lastEnd) + importLines.join('\n') + '\n' + src.slice(lastEnd);
  } else {
    src = src.slice(0, lastEnd) + '\n' + importLines.join('\n') + src.slice(lastEnd);
  }
  changedFiles += 1;
  if (!dry) writeFileSync(file, src);
}
console.log(`codemod-fa-icons${dry ? ' (dry)' : ''}: A ${report.A} · B ${report.B} · C ${report.C} · D ${report.D} · E ${report.E} · files ${changedFiles} · left for a hand ${report.left.length}`);
if (report.left.length) {
  writeFileSync(join(ROOT, 'docs/load/2026-11-07/fa-left-by-hand.txt'), report.left.join('\n') + '\n');
  console.log(`  the list: docs/load/2026-11-07/fa-left-by-hand.txt`);
}
