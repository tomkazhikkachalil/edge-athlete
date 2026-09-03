// Browser-floor rules (Sep 2026) — the analysis behind scripts/check-browser-syntax.mjs,
// split out so src/lib/__tests__/browser-floor-rules.test.ts can pin it on fixtures.
//
// The project's floor is iOS 15 / Safari 15 (package.json browserslist). Two
// classes of break reach that floor, and they need two different checks:
//
//   1. SYNTAX the engine cannot PARSE — one hit kills the whole chunk before a
//      line runs. Class static blocks, `#x in obj`, regex `d`/`v` flags, top-
//      level await in a classic chunk. (Round 5, Sep 3: Next 16's own runtime
//      and Sentry shipped static blocks; nothing hydrated on an older iPhone.)
//   2. RUNTIME METHODS the engine parses happily and throws on at CALL time —
//      `x.toSpliced()` is valid ES2022 syntax to acorn and a TypeError on
//      JavaScriptCore below 16.4. (Round 6, same day: AppHeader's nav used
//      toSpliced, so every page with the header hit the error boundary on the
//      same phone AFTER round 5 had fixed the parse failure.) Next's
//      polyfill-module covers exactly flat/flatMap/finally/fromEntries/at/
//      hasOwn/URL.canParse — nothing newer, so these are ours to keep out.
//
// A finding is a call the floor cannot make. The accepted ways to keep an API
// newer than the floor: feature-detect it (`typeof x.m === 'function'`, `x.m ||
// fallback`, `if (x.m)`), or install it (`X.prototype.m = …`, `window.g = …`) —
// all of which this file recognises and skips. A false positive (a library
// method that happens to share a name) is resolved the same way, or by pinning
// the site here with a comment. Never by widening the floor.
import * as acorn from 'acorn';

/** Instance methods above the floor — matched on any receiver. */
export const FLOOR_INSTANCE_METHODS = Object.freeze({
  toSpliced: 'Safari 16.4+',
  toSorted: 'Safari 16.4+',
  toReversed: 'Safari 16.4+',
  findLast: 'Safari 15.4+',
  findLastIndex: 'Safari 15.4+',
});

/** Static members above the floor — matched on the named global only. */
export const FLOOR_STATIC_MEMBERS = Object.freeze({
  Array: { fromAsync: 'Safari 17.4+' },
  Promise: { withResolvers: 'Safari 17.4+' },
  Object: { groupBy: 'Safari 17.4+' },
  Map: { groupBy: 'Safari 17.4+' },
  AbortSignal: { timeout: 'Safari 16+', any: 'Safari 17.4+' },
  Intl: { Segmenter: 'Safari 14.1+ but absent on some WebKit builds; keep behind typeof' },
});

/** Bare globals above the floor — a call without a `typeof` guard is a finding. */
export const FLOOR_BARE_GLOBALS = Object.freeze({
  structuredClone: 'Safari 15.4+',
});

/**
 * Globals from FLOOR_BARE_GLOBALS that the (app) root layout installs from a
 * blocking head script BEFORE any chunk runs (src/lib/floor-polyfills.ts), so a
 * bare call in a chunk is safe on our pages and is NOT reported. Next.js's own
 * router chunk calls structuredClone unguarded; that is what this covers. The
 * test pins that the head script really installs every name listed here.
 */
export const HEAD_POLYFILLED_GLOBALS = Object.freeze(['structuredClone']);

function memberName(node) {
  if (node.type !== 'MemberExpression') return null;
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string')
    return node.property.value;
  return null;
}

/** `X.prototype` — a polyfill definition or a feature check, never a call site. */
function isPrototypeReceiver(obj) {
  return obj.type === 'MemberExpression' && memberName(obj) === 'prototype';
}

/**
 * True when `node`, in `parent`, is being TESTED or INSTALLED rather than
 * called: `typeof node`, `node || …`, `node ?? …`, `node ? … : …`, `if (node)`,
 * `!node`, `node = …`, `"m" in …` never reaches here (a Literal).
 */
function isGuardOrInstall(node, parent) {
  if (!parent) return false;
  switch (parent.type) {
    case 'UnaryExpression':
      return parent.operator === 'typeof' || parent.operator === '!';
    case 'LogicalExpression':
      return parent.left === node;
    case 'ConditionalExpression':
    case 'IfStatement':
      return parent.test === node;
    case 'AssignmentExpression':
      return parent.left === node;
    case 'BinaryExpression':
      // `x.m === undefined`, `void 0 === x.m`, `"function" == typeof …` (typeof handled above)
      return /^[!=]==?$/.test(parent.operator);
    default:
      return false;
  }
}

/** Identifier positions that are declarations or property names, not global reads. */
function isNonReferenceIdentifier(node, parent) {
  if (!parent) return false;
  if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return true;
  if (parent.type === 'Property' && parent.key === node && !parent.computed) return true;
  if (parent.type === 'VariableDeclarator' && parent.id === node) return true;
  if (parent.type === 'MethodDefinition' || parent.type === 'PropertyDefinition') return parent.key === node;
  if (/Function/.test(parent.type)) return parent.params.includes(node) || parent.id === node;
  if (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement') return true;
  return false;
}

/**
 * Scan one chunk's source. Returns human-readable findings (empty = clean).
 * Parses as a classic script first (Turbopack's default), then as a module.
 */
export function scanChunkSource(src, file) {
  const findings = [];
  let ast;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'script', allowHashBang: true });
  } catch {
    try {
      ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    } catch (err) {
      return [`${file}: does not parse as ES2022 (${err.message})`];
    }
  }

  const walk = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;

    // --- 1. syntax the floor cannot parse -----------------------------------
    if (node.type === 'StaticBlock') findings.push(`${file}: class static block (Safari 16.4+) @${node.start}`);
    if (node.type === 'BinaryExpression' && node.operator === 'in' && node.left?.type === 'PrivateIdentifier')
      findings.push(`${file}: \`#x in obj\` brand check (Safari 16.4+) @${node.start}`);
    if (node.type === 'Literal' && node.regex && /[dv]/.test(node.regex.flags))
      findings.push(`${file}: regex flag ${node.regex.flags} (Safari 16.4+/17+) @${node.start}`);

    // --- 2. runtime members the floor cannot call ---------------------------
    if (node.type === 'MemberExpression' && !isGuardOrInstall(node, parent) && !isPrototypeReceiver(node.object)) {
      const name = memberName(node);
      if (name && Object.hasOwn(FLOOR_INSTANCE_METHODS, name)) {
        findings.push(`${file}: .${name}() (${FLOOR_INSTANCE_METHODS[name]}) @${node.start}`);
      } else if (name && node.object.type === 'Identifier' && Object.hasOwn(FLOOR_STATIC_MEMBERS, node.object.name)) {
        const statics = FLOOR_STATIC_MEMBERS[node.object.name];
        if (Object.hasOwn(statics, name))
          findings.push(`${file}: ${node.object.name}.${name} (${statics[name]}) @${node.start}`);
      }
    }
    if (
      node.type === 'Identifier' &&
      Object.hasOwn(FLOOR_BARE_GLOBALS, node.name) &&
      !HEAD_POLYFILLED_GLOBALS.includes(node.name) &&
      !isNonReferenceIdentifier(node, parent) &&
      !isGuardOrInstall(node, parent)
    ) {
      findings.push(`${file}: ${node.name}() (${FLOOR_BARE_GLOBALS[node.name]}) @${node.start}`);
    }

    for (const key of Object.keys(node)) {
      if (key === 'type' || key === 'start' || key === 'end' || key === 'loc') continue;
      const child = node[key];
      if (Array.isArray(child)) child.forEach(c => walk(c, node));
      else if (child && typeof child.type === 'string') walk(child, node);
    }
  };
  walk(ast, null);
  return findings;
}
