/**
 * Schema provenance — the CATALOG facets: policies and functions
 * (provenance round, PR B — Sep 15 2026).
 *
 * The core (`schema-inventory-core.mjs`) proves every live TABLE and COLUMN
 * has an owner in the numbered chain. This module does the same for the two
 * things PostgREST's OpenAPI cannot see:
 *
 *  • POLICIES — every live RLS policy in schema public is named by a numbered
 *    migration whose LAST statement for that (table, policy) is a CREATE with
 *    the same command, roles and permissiveness; and every policy the chain
 *    still claims exists live (a stale claim = an archived script dropped or
 *    renamed it — 001's "Users can view their own profile" family). Policy
 *    BODIES are recorded verbatim by the baselines; body equality is NOT
 *    checked statically (pg_get_expr reformats every expression).
 *  • FUNCTIONS — every live non-extension function in public is defined by a
 *    numbered migration, and the chain's LAST definition (matched by name +
 *    normalised argument types — two real overloads exist) has the SAME BODY
 *    as live: md5 of the exact dollar-quoted text vs md5(prosrc). A body that
 *    differs only in whitespace (a paste artefact) is informational; a real
 *    difference, a SECURITY DEFINER flag or a search_path that differs is
 *    drift (Tom's call: checksum-strict).
 *
 * The live side is `public.provenance_inventory()` (migration 195), a
 * service-role-only RPC; `scripts/schema-inventory.mjs` fetches it. This
 * module is pure — no I/O, no dependencies beyond node:crypto — and node-only
 * vitest imports it (the browser-floor precedent).
 *
 * How the chain is read (the parts that differ from the core):
 *  • an OFFSET-PRESERVING MASK — comments, string-literal interiors and
 *    dollar-quoted interiors become spaces, newlines and both dollar tags
 *    stay, so `masked.length === sql.length`; every regex runs on the mask
 *    and every payload (a function body, a search_path value) is sliced from
 *    the RAW text at the same offsets. A `--` inside a body is body text and
 *    part of prosrc; a `$$` inside a comment is nothing;
 *  • recursion into `DO $$ … $$` bodies (guarded CREATE POLICYs live there)
 *    and into `EXECUTE $tag$ … $tag$` strings (003 / 014 create two trigger
 *    functions that way, two levels down);
 *  • `EXECUTE format(…)` / `EXECUTE '…' || …` is a DYNAMIC SITE: recorded
 *    with its file and line, its kind, and the `proname = '…'` /
 *    `proname IN (…)` literals of the enclosing block — which resolves every
 *    dynamic DROP / ALTER FUNCTION in the chain (022, 024, 051, 082, 083,
 *    084, 108, 127) and leaves 052's array-driven CREATE POLICY loops
 *    honestly unresolved (`names: []`) for the baseline to make literal.
 */
import { createHash } from 'node:crypto';
import { closingQuote, ident } from './schema-inventory-core.mjs';

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?`;
const TAG_RE = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

// ── the mask ────────────────────────────────────────────────────────────────

function blank(s) {
  return s.replace(/[^\n]/g, ' ');
}

/** Offset-preserving mask: `masked.length === sql.length`; `dollars` lists
 *  every dollar-quoted segment with its offsets (relative to `sql`). */
export function maskSql(sql) {
  const parts = [];
  const dollars = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      const end = nl === -1 ? sql.length : nl;
      parts.push(' '.repeat(end - i));
      i = end;
      continue;
    }
    if (two === '/*') {
      const e = sql.indexOf('*/', i + 2);
      const end = e === -1 ? sql.length : e + 2;
      parts.push(blank(sql.slice(i, end)));
      i = end;
      continue;
    }
    if (ch === "'") {
      const end = closingQuote(sql, i);
      parts.push("'" + blank(sql.slice(i + 1, end)) + (end < sql.length ? "'" : ''));
      i = end + 1;
      continue;
    }
    if (ch === '"') {
      let j = i + 1;
      while (j < sql.length) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j++;
      }
      const end = Math.min(j, sql.length - 1);
      parts.push(sql.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (ch === '$') {
      const m = TAG_RE.exec(sql.slice(i, i + 64));
      if (m) {
        const tag = m[0];
        const close = sql.indexOf(tag, i + tag.length);
        if (close !== -1) {
          dollars.push({ start: i, bodyStart: i + tag.length, bodyEnd: close, end: close + tag.length, tag });
          parts.push(tag + blank(sql.slice(i + tag.length, close)) + tag);
          i = close + tag.length;
          continue;
        }
      }
    }
    parts.push(ch);
    i++;
  }
  return { masked: parts.join(''), dollars };
}

/** Split on `;` at paren depth 0 over the mask; offsets relative to `text`. */
export function statements(text, masked) {
  const out = [];
  let depth = 0;
  let start = 0;
  const push = (a, b) => {
    // Leading whitespace is measured on the MASK: a comment before the
    // statement is blank there, so the statement proper starts after it.
    const mk = masked.slice(a, b);
    if (!mk.trim()) return;
    const lead = mk.length - mk.trimStart().length;
    out.push({ start: a + lead, end: b, raw: text.slice(a + lead, b), masked: mk.slice(lead) });
  };
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === ';' && depth === 0) {
      push(start, i);
      start = i + 1;
    }
  }
  push(start, masked.length);
  return out;
}

/** The text inside the balanced parenthesis opening at `open` (on the mask). */
function balancedSpan(masked, open) {
  let depth = 0;
  for (let i = open; i < masked.length; i++) {
    if (masked[i] === '(') depth++;
    else if (masked[i] === ')') {
      depth--;
      if (depth === 0) return { start: open + 1, end: i };
    }
  }
  return { start: open + 1, end: masked.length };
}

function splitTopLevel(masked, raw) {
  const parts = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < masked.length; i++) {
    const ch = masked[i];
    if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push({ masked: masked.slice(last, i), raw: raw.slice(last, i) });
      last = i + 1;
    }
  }
  parts.push({ masked: masked.slice(last), raw: raw.slice(last) });
  return parts.filter(p => p.masked.trim());
}

// PL/pgSQL control-flow prefixes that precede a DDL statement inside a DO
// body (`begin`, `if … then`, `foreach … loop`, `for r in … loop`, `exception
// when … then`, `end if` …). `.*?` spans newlines (s flag).
const PLPGSQL_PREFIX = /^(?:declare\s+.*?\s+(?=begin\s)|begin\s+|if\s+.*?\s+then\s+|elsif\s+.*?\s+then\s+|else\s+|end\s+if\s*|end\s*loop\s*|foreach\s+.*?\s+loop\s+|for\s+.*?\s+loop\s+|while\s+.*?\s+loop\s+|exception\s+when\s+.*?\s+then\s+|end\s*)+/is;

// ── normalisation ───────────────────────────────────────────────────────────

const TYPE_ALIASES = {
  int: 'integer', int4: 'integer', int8: 'bigint', int2: 'smallint',
  bool: 'boolean', float8: 'double precision', float4: 'real',
  timestamptz: 'timestamp with time zone', timestamp: 'timestamp without time zone',
  varchar: 'character varying', char: 'character', decimal: 'numeric',
  serial: 'integer', bigserial: 'bigint',
};
const TYPE_WORDS = new Set([
  'uuid', 'text', 'integer', 'int', 'int4', 'bigint', 'int8', 'smallint', 'int2', 'boolean', 'bool',
  'numeric', 'decimal', 'date', 'timestamp', 'timestamptz', 'jsonb', 'json', 'float8', 'float4', 'real',
  'double', 'character', 'varchar', 'char', 'interval', 'bytea', 'tsvector', 'tsquery', 'inet', 'time',
  'anyelement', 'anyarray', 'record', 'regclass', 'regprocedure', 'oid', 'name', 'void', 'citext', 'point',
]);

/** `INT[]` → `integer[]`, `public.uuid` → `uuid`, `VARCHAR(20)` → `character varying`. */
export function normalizeType(raw) {
  let t = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  t = t.replace(/^(?:public|pg_catalog)\./, '');
  let arrays = '';
  const arr = /((?:\s*\[\s*\d*\s*\])+)$/.exec(t);
  if (arr) {
    arrays = '[]'.repeat((arr[1].match(/\[/g) || []).length);
    t = t.slice(0, arr.index).trim();
  }
  if (/\s+array$/.test(t)) {
    arrays += '[]';
    t = t.replace(/\s+array$/, '');
  }
  t = t.replace(/\s*\([^)]*\)\s*$/, '').trim();
  if (t === 'timestamp without time zone' || t === 'timestamp with time zone') return t + arrays;
  if (t === 'double precision' || t === 'character varying') return t + arrays;
  if (t === 'character varying' || t === 'time without time zone' || t === 'time with time zone') return t + arrays;
  if (TYPE_ALIASES[t]) t = TYPE_ALIASES[t];
  return t + arrays;
}

/** A CREATE FUNCTION argument list → its identity types (OUT args dropped). */
export function identityTypes(argsRaw, argsMasked) {
  const types = [];
  for (const part of splitTopLevel(argsMasked ?? argsRaw, argsRaw)) {
    // Types come from the MASK: comments inside an argument list are blank
    // there, and a literal DEFAULT is dropped below anyway.
    let a = part.masked.replace(/\s+/g, ' ').trim();
    if (!a) continue;
    a = a.replace(/\s+(?:default|=)\s+.*$/i, '').trim();
    const words = a.split(' ');
    let mode = null;
    if (/^(in|out|inout|variadic)$/i.test(words[0]) && words.length > 1) mode = words.shift().toLowerCase();
    if (mode === 'out') continue;
    let type;
    if (words.length === 1 || TYPE_WORDS.has(words[0].toLowerCase()) || /^"?(?:public\.)?[a-z_]+"?\s*\(/i.test(a)) type = words.join(' ');
    else type = words.slice(1).join(' ');
    types.push(normalizeType(type));
  }
  return types;
}

/** `search_path = 'public', extensions` / `TO ''` / `search_path=""` → a canonical `public, extensions` / `` string. */
export function normalizeSearchPath(raw) {
  if (raw === null || raw === undefined) return null;
  let v = String(raw).trim();
  v = v.replace(/^search_path\s*(?:=|to)\s*/i, '');
  return v
    .split(',')
    .map(s => s.trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase())
    .filter(Boolean)
    .join(', ');
}

export const md5 = s => createHash('md5').update(s, 'utf8').digest('hex');
/** The RPC's `body_md5_norm`: CRLF → LF, trailing whitespace per line stripped, outer trim of space/tab/newline. */
export const normalizeBody = s => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');

export const fnKey = (name, types) => `${name}(${types.join(',')})`;

/** A policy name: quoted → the inner text verbatim (`""` → `"`); bare → lowercase. */
export function policyName(raw) {
  const s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1).replace(/""/g, '"');
  return s.toLowerCase();
}

function roleList(raw) {
  return raw
    .split(',')
    .map(r => r.trim().replace(/^"|"$/g, '').toLowerCase())
    .filter(Boolean)
    .sort();
}

// ── the chain ───────────────────────────────────────────────────────────────

/**
 * Parse the numbered chain for policies and functions. `files` = [{ name, sql }]
 * in chain order. Returns:
 *   policies:  Map<'table|name', { state:'created'|'dropped', cmd, roles, permissive, file, line, using?, check? }>
 *   functions: Map<key, { state, name, types, file, line, body, bodyMd5, bodyMd5Norm, secdef, searchPath, language, returns }>
 *   byName:    Map<name, Set<key>>
 *   dynamic:   [{ file, line, kind, names, snippet }]
 *   foreignSchema: [{ file, line, statement, table }]   — DDL on a non-public schema (never a claim)
 */
export function parseCatalogChain(files) {
  const policies = new Map();
  const functions = new Map();
  const byName = new Map();
  const dynamic = [];
  const foreignSchema = [];

  const setPolicy = (key, entry) => {
    policies.delete(key);
    policies.set(key, entry);
  };
  const setFunction = (key, entry) => {
    functions.delete(key);
    functions.set(key, entry);
    if (!byName.has(entry.name)) byName.set(entry.name, new Set());
    byName.get(entry.name).add(key);
  };
  const keysOf = name => [...(byName.get(name) ?? [])];

  for (const f of files) {
    const lineOf = abs => f.sql.slice(0, abs).split('\n').length;
    parseRegion(f.sql, 0, null);

    function parseRegion(text, base, blockRaw) {
      const { masked, dollars } = maskSql(text);
      for (const st of statements(text, masked)) {
        const abs = base + st.start;
        const pm = PLPGSQL_PREFIX.exec(st.masked);
        const lead = pm ? pm[0].length : 0;
        const m = st.masked.slice(lead);
        const r = st.raw.slice(lead);
        const line = lineOf(abs + lead);
        const inStatement = d => d.start >= st.start + lead && d.start < st.end;
        let x;

        // DO $$ … $$ → recurse into the body (its statements carry PL/pgSQL prefixes).
        if (/^do\s+\$/i.test(m)) {
          const d = dollars.find(inStatement);
          if (d) parseRegion(text.slice(d.bodyStart, d.bodyEnd), base + d.bodyStart, text.slice(d.bodyStart, d.bodyEnd));
          continue;
        }
        // EXECUTE $tag$ … $tag$ → a literal statement two levels down (003 / 014).
        if (/^execute\s+\$/i.test(m)) {
          const d = dollars.find(inStatement);
          if (d) parseRegion(text.slice(d.bodyStart, d.bodyEnd), base + d.bodyStart, blockRaw);
          continue;
        }
        // EXECUTE format(…) / EXECUTE '…' || … → a dynamic site.
        if (/^execute\b/i.test(m)) {
          const lower = r.toLowerCase();
          const kind = ['create policy', 'drop policy', 'drop function', 'alter function', 'create function', 'revoke', 'grant', 'create trigger', 'drop trigger', 'create index']
            .find(k => lower.includes(k)) ?? 'other';
          const names = [];
          if (blockRaw) {
            const re = /proname\s*(?:=\s*'([^']+)'|in\s*\(([^)]*)\))/gi;
            let pm2;
            while ((pm2 = re.exec(blockRaw)) !== null) {
              if (pm2[1]) names.push(pm2[1]);
              else for (const n of pm2[2].match(/'([^']+)'/g) ?? []) names.push(n.slice(1, -1));
            }
          }
          const site = { file: f.name, line, kind, names: [...new Set(names)], snippet: r.replace(/\s+/g, ' ').slice(0, 160) };
          dynamic.push(site);
          if (kind === 'drop function') for (const n of site.names) for (const k of keysOf(n)) if (functions.has(k)) setFunction(k, { ...functions.get(k), state: 'dropped', file: f.name, line });
          if (kind === 'alter function') {
            const sp = /search_path\s*(?:=|to)\s*((?:''|'[^']*'|"[^"]*"|[A-Za-z_][\w$]*)(?:\s*,\s*(?:''|'[^']*'|"[^"]*"|[A-Za-z_][\w$]*))*)/i.exec(r.replace(/''/g, "'"));
            const sec = /security\s+(definer|invoker)/i.exec(r);
            for (const n of site.names) for (const k of keysOf(n)) {
              const e = functions.get(k);
              if (!e || e.state !== 'created') continue;
              const patch = { ...e };
              if (sp) patch.searchPath = normalizeSearchPath(sp[1]);
              if (sec) patch.secdef = sec[1].toLowerCase() === 'definer';
              setFunction(k, patch);
            }
          }
          continue;
        }

        // CREATE POLICY name ON table [AS …] [FOR cmd] [TO roles] [USING (…)] [WITH CHECK (…)]
        if ((x = new RegExp(String.raw`^create\s+policy\s+("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s+on\s+(${IDENT})`, 'i').exec(m))) {
          const name = policyName(x[1]);
          const tableRaw = x[2];
          const table = ident(tableRaw);
          if (table.includes('.')) {
            foreignSchema.push({ file: f.name, line, statement: 'create policy', table });
            continue;
          }
          const rest = m.slice(x[0].length);
          const restRaw = r.slice(x[0].length);
          const bodyAt = rest.search(/\b(?:using|with\s+check)\b/i);
          const head = bodyAt === -1 ? rest : rest.slice(0, bodyAt);
          const permissive = /\bas\s+restrictive\b/i.test(head) ? 'RESTRICTIVE' : 'PERMISSIVE';
          const cmdM = /\bfor\s+(all|select|insert|update|delete)\b/i.exec(head);
          const cmd = cmdM ? cmdM[1].toUpperCase() : 'ALL';
          const toM = /\bto\s+((?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\s*,\s*(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))*)/i.exec(head);
          const roles = toM ? roleList(toM[1]) : ['public'];
          const entry = { state: 'created', cmd, roles, permissive, file: f.name, line };
          const uM = /\busing\s*\(/i.exec(rest);
          if (uM) {
            const span = balancedSpan(rest, uM.index + uM[0].length - 1);
            entry.using = restRaw.slice(span.start, span.end).trim();
          }
          const cM = /\bwith\s+check\s*\(/i.exec(rest);
          if (cM) {
            const span = balancedSpan(rest, cM.index + cM[0].length - 1);
            entry.check = restRaw.slice(span.start, span.end).trim();
          }
          setPolicy(`${table}|${name}`, entry);
          continue;
        }
        if ((x = new RegExp(String.raw`^drop\s+policy\s+(?:if\s+exists\s+)?("(?:[^"]|"")+"|[A-Za-z_][A-Za-z0-9_]*)\s+on\s+(${IDENT})`, 'i').exec(m))) {
          const name = policyName(x[1]);
          const table = ident(x[2]);
          if (table.includes('.')) {
            foreignSchema.push({ file: f.name, line, statement: 'drop policy', table });
            continue;
          }
          setPolicy(`${table}|${name}`, { state: 'dropped', file: f.name, line });
          continue;
        }

        // CREATE [OR REPLACE] FUNCTION name(args) … AS $tag$ body $tag$ …
        if ((x = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?function\s+(${IDENT})\s*\(`, 'i').exec(m))) {
          const name = ident(x[1]);
          const open = x[0].length - 1;
          const args = balancedSpan(m, open);
          const types = identityTypes(r.slice(args.start, args.end), m.slice(args.start, args.end));
          const after = m.slice(args.end + 1);
          const afterRaw = r.slice(args.end + 1);
          const d = dollars.find(dd => dd.start >= st.start + lead + args.end + 1 && dd.start < st.end);
          const asM = /\bas\s*\$/i.exec(after);
          const entry = { state: 'created', name, types, file: f.name, line, body: null, bodyMd5: null, bodyMd5Norm: null, secdef: false, searchPath: null, language: null, returns: null };
          if (d && asM) {
            entry.body = text.slice(d.bodyStart, d.bodyEnd);
            entry.bodyMd5 = md5(entry.body);
            entry.bodyMd5Norm = md5(normalizeBody(entry.body));
          }
          const lang = /\blanguage\s+(\w+)/i.exec(after);
          if (lang) entry.language = lang[1].toLowerCase();
          const sec = /\bsecurity\s+(definer|invoker)/i.exec(after);
          if (sec) entry.secdef = sec[1].toLowerCase() === 'definer';
          const sp = /\bset\s+search_path\s*(?:=|to)\s*/i.exec(after);
          if (sp) {
            const tail = after.slice(sp.index + sp[0].length);
            const vm = /^((?:"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*)(?:\s*,\s*(?:"[^"]*"|'[^']*'|[A-Za-z_$][\w$]*))*)/.exec(tail);
            if (vm) entry.searchPath = normalizeSearchPath(afterRaw.slice(sp.index + sp[0].length, sp.index + sp[0].length + vm[1].length));
          }
          const ret = /\breturns\s+(setof\s+)?(table\s*\(|[\w.\[\]]+(?:\s+(?:with(?:out)?\s+time\s+zone|precision|varying))?)/i.exec(after);
          if (ret) entry.returns = (ret[1] ? 'setof ' : '') + ret[2].replace(/\s*\($/, '').replace(/\s+/g, ' ').trim().toLowerCase();
          setFunction(fnKey(name, types), entry);
          continue;
        }
        if ((x = /^drop\s+function\s+(?:if\s+exists\s+)?([\s\S]+?)\s*(?:\b(?:cascade|restrict)\b\s*)?$/i.exec(m))) {
          const list = splitTopLevel(x[1], r.slice(m.indexOf(x[1]), m.indexOf(x[1]) + x[1].length));
          for (const item of list) {
            const im = new RegExp(String.raw`^\s*(${IDENT})\s*(?:\(([\s\S]*)\))?\s*$`).exec(item.masked);
            if (!im) continue;
            const name = ident(im[1]);
            const keys = im[2] !== undefined ? [fnKey(name, identityTypes(item.raw.slice(item.masked.indexOf('(') + 1, item.masked.lastIndexOf(')')), im[2]))] : keysOf(name);
            for (const k of keys) {
              const prev = functions.get(k);
              setFunction(k, { ...(prev ?? { name, types: [] }), state: 'dropped', file: f.name, line });
            }
          }
          continue;
        }
        if ((x = new RegExp(String.raw`^alter\s+function\s+(${IDENT})\s*(?:\(([^)]*)\))?\s+([\s\S]*)$`, 'i').exec(m))) {
          const name = ident(x[1]);
          const restRaw = r.slice(x.index + x[0].length - x[3].length);
          const keys = x[2] !== undefined && functions.has(fnKey(name, identityTypes(r.slice(m.indexOf('(') + 1, m.indexOf(')')), x[2]))) ? [fnKey(name, identityTypes(r.slice(m.indexOf('(') + 1, m.indexOf(')')), x[2]))] : keysOf(name);
          const sp = /\bset\s+search_path\s*(?:=|to)\s*((?:''|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*)(?:\s*,\s*(?:''|'[^']*'|"[^"]*"|[A-Za-z_$][\w$]*))*)/i.exec(restRaw);
          const reset = /\breset\s+search_path\b/i.test(restRaw);
          const sec = /\bsecurity\s+(definer|invoker)\b/i.exec(restRaw);
          for (const k of keys) {
            const e = functions.get(k);
            if (!e || e.state !== 'created') continue;
            const patch = { ...e };
            if (sp) patch.searchPath = normalizeSearchPath(sp[1]);
            if (reset) patch.searchPath = null;
            if (sec) patch.secdef = sec[1].toLowerCase() === 'definer';
            setFunction(k, patch);
          }
          continue;
        }
      }
    }
  }
  return { policies, functions, byName, dynamic, foreignSchema };
}

// ── the live side ───────────────────────────────────────────────────────────

/** @typedef {{ key: string, table: string, name: string, cmd: string, roles: string[], permissive: string, qual: string|null, withCheck: string|null }} LivePolicy */
/** @typedef {{ key: string, name: string, types: string[], identityArgs: string, returns: string|null, kind: string, language: string|null, secdef: boolean, searchPath: string|null, bodyMd5: string|null, bodyMd5Norm: string|null, bodyBytes: number|null, definition: string|null, acl: unknown, owner: string|null }} LiveFunction */
/** @typedef {{ meta: unknown, tables: Set<string>, policies: LivePolicy[], functions: LiveFunction[], triggers: unknown[] }} LiveCatalog */
/**
 * @typedef {Object} CatalogDiff
 * @property {Array<any>} unownedPolicies
 * @property {Array<any>} stalePolicyClaims
 * @property {Array<any>} policyMismatch
 * @property {Array<any>} unownedFunctions
 * @property {Array<any>} bodyDrift
 * @property {Array<any>} whitespaceOnly
 * @property {Array<any>} configDrift
 * @property {Array<any>} chainOnlyFunctions
 * @property {Array<any>} documented
 * @property {Array<any>} staleAllowlist
 * @property {Array<any>} dynamic
 * @property {Array<any>} foreignSchema
 * @property {Record<string, number>} counts
 * @property {boolean} ok
 */

/** The RPC's jsonb → a comparable shape.
 *  @param {any} json
 *  @returns {LiveCatalog} */
export function liveFromCatalog(json) {
  const tables = new Set((json.rls ?? []).map(t => t.table));
  const policies = (json.policies ?? []).map(p => ({
    key: `${p.table}|${p.name}`,
    table: p.table,
    name: p.name,
    cmd: String(p.cmd ?? 'ALL').toUpperCase() === '*' ? 'ALL' : String(p.cmd ?? 'ALL').toUpperCase(),
    roles: [...(p.roles ?? ['public'])].map(r => String(r).toLowerCase()).sort(),
    permissive: String(p.permissive ?? 'PERMISSIVE').toUpperCase(),
    qual: p.qual ?? null,
    withCheck: p.with_check ?? null,
  }));
  const functions = (json.functions ?? []).map(fn => {
    const types = String(fn.arg_types ?? '').split(',').map(s => s.trim()).filter(Boolean).map(normalizeType);
    const cfg = (fn.config ?? []).find(c => /^search_path=/i.test(c));
    return {
      key: fnKey(fn.name, types),
      name: fn.name,
      types,
      identityArgs: fn.identity_args ?? '',
      returns: fn.returns ?? null,
      kind: fn.kind ?? 'f',
      language: fn.language ?? null,
      secdef: Boolean(fn.secdef),
      searchPath: cfg ? normalizeSearchPath(cfg.replace(/^search_path=/i, '')) : null,
      bodyMd5: fn.body_md5 ?? null,
      bodyMd5Norm: fn.body_md5_norm ?? null,
      bodyBytes: fn.body_bytes ?? null,
      definition: fn.definition ?? null,
      acl: fn.acl ?? null,
      owner: fn.owner ?? null,
    };
  });
  return { meta: json.meta ?? null, tables, policies, functions, triggers: json.triggers ?? [] };
}

// ── the diff ────────────────────────────────────────────────────────────────

const where = e => `${e.file}:${e.line}`;

/**
 * `allowlist` entries with kind 'policy' {table, name} or 'function' {name, args}.
 * Gating: unownedPolicies, stalePolicyClaims, policyMismatch, unownedFunctions,
 * bodyDrift, configDrift, staleAllowlist. Informational: whitespaceOnly,
 * chainOnlyFunctions, dynamic, foreignSchema.
 */
/** @param {LiveCatalog} live
 *  @param {ReturnType<typeof parseCatalogChain>} chain
 *  @param {Array<any>} [allowlist]
 *  @returns {CatalogDiff} */
export function diffCatalog(live, chain, allowlist = []) {
  const allowPolicy = new Map(allowlist.filter(e => e.kind === 'policy').map(e => [`${e.table}|${e.name}`, e]));
  const allowFn = new Map(allowlist.filter(e => e.kind === 'function').map(e => [fnKey(e.name, String(e.args ?? '').split(',').map(s => s.trim()).filter(Boolean).map(normalizeType)), e]));
  const usedAllow = new Set();
  const r = /** @type {CatalogDiff} */ ({
    ok: false,
    unownedPolicies: [], stalePolicyClaims: [], policyMismatch: [],
    unownedFunctions: [], bodyDrift: [], whitespaceOnly: [], configDrift: [], chainOnlyFunctions: [],
    documented: [], staleAllowlist: [],
    dynamic: chain.dynamic, foreignSchema: chain.foreignSchema,
    counts: { livePolicies: live.policies.length, liveFunctions: live.functions.length, liveTriggers: live.triggers.length, chainPolicies: 0, chainFunctions: 0 },
  });
  const livePolicyKeys = new Set(live.policies.map(p => p.key));
  for (const p of live.policies) {
    const c = chain.policies.get(p.key);
    const allowed = allowPolicy.get(p.key);
    const flag = (why) => {
      if (allowed) { usedAllow.add(p.key); r.documented.push({ kind: 'policy', key: p.key }); }
      else r.unownedPolicies.push({ table: p.table, name: p.name, cmd: p.cmd, why });
    };
    if (!c) flag('no numbered file names it');
    else if (c.state === 'dropped') flag(`the chain last DROPs it (${where(c)})`);
    else if (c.cmd !== p.cmd || c.roles.join(',') !== p.roles.join(',') || c.permissive !== p.permissive) {
      if (allowed) { usedAllow.add(p.key); r.documented.push({ kind: 'policy', key: p.key }); }
      else r.policyMismatch.push({ table: p.table, name: p.name, live: { cmd: p.cmd, roles: p.roles, permissive: p.permissive }, chain: { cmd: c.cmd, roles: c.roles, permissive: c.permissive, at: where(c) } });
    }
  }
  for (const [key, c] of chain.policies) {
    if (c.state !== 'created') continue;
    r.counts.chainPolicies++;
    const [table] = key.split('|');
    if (!live.tables.has(table)) continue; // table provenance owns that question
    if (!livePolicyKeys.has(key)) r.stalePolicyClaims.push({ table, name: key.slice(table.length + 1), cmd: c.cmd, at: where(c) });
  }
  const liveFnKeys = new Set(live.functions.map(fn => fn.key));
  for (const fn of live.functions) {
    const c = chain.functions.get(fn.key);
    const allowed = allowFn.get(fn.key);
    const document = () => { usedAllow.add(fn.key); r.documented.push({ kind: 'function', key: fn.key }); };
    if (!c || c.state !== 'created') {
      if (allowed) { document(); continue; }
      const others = [...(chain.byName.get(fn.name) ?? [])].filter(k => k !== fn.key && chain.functions.get(k)?.state === 'created');
      r.unownedFunctions.push({
        key: fn.key, identityArgs: fn.identityArgs, owner: fn.owner,
        why: !c ? 'no numbered file defines it' : `the chain last DROPs it (${where(c)})`,
        hint: others.length ? `the chain defines ${others.map(k => `${k} at ${where(chain.functions.get(k))}`).join(', ')}` : null,
      });
      continue;
    }
    if (c.bodyMd5 !== fn.bodyMd5) {
      if (c.bodyMd5Norm === fn.bodyMd5Norm) r.whitespaceOnly.push({ key: fn.key, at: where(c) });
      else if (allowed) document();
      else r.bodyDrift.push({ key: fn.key, at: where(c), liveMd5: fn.bodyMd5, chainMd5: c.bodyMd5, liveBytes: fn.bodyBytes, chainBytes: c.body?.length ?? null });
    }
    const cfgDiff = [];
    if (Boolean(c.secdef) !== fn.secdef) cfgDiff.push(`secdef live=${fn.secdef} chain=${Boolean(c.secdef)}`);
    if ((c.searchPath ?? null) !== (fn.searchPath ?? null)) cfgDiff.push(`search_path live=${JSON.stringify(fn.searchPath)} chain=${JSON.stringify(c.searchPath)}`);
    if (cfgDiff.length) {
      if (allowed) document();
      else r.configDrift.push({ key: fn.key, at: where(c), diff: cfgDiff });
    }
  }
  for (const [key, c] of chain.functions) {
    if (c.state !== 'created') continue;
    r.counts.chainFunctions++;
    if (!liveFnKeys.has(key)) r.chainOnlyFunctions.push({ key, at: where(c) });
  }
  for (const [key, e] of allowPolicy) {
    if (!livePolicyKeys.has(key)) r.staleAllowlist.push({ ...e, why: 'not live' });
    else if (!usedAllow.has(key)) r.staleAllowlist.push({ ...e, why: 'owned now' });
  }
  for (const [key, e] of allowFn) {
    if (!liveFnKeys.has(key)) r.staleAllowlist.push({ ...e, why: 'not live' });
    else if (!usedAllow.has(key)) r.staleAllowlist.push({ ...e, why: 'owned now' });
  }
  r.ok = !r.unownedPolicies.length && !r.stalePolicyClaims.length && !r.policyMismatch.length
    && !r.unownedFunctions.length && !r.bodyDrift.length && !r.configDrift.length && !r.staleAllowlist.length;
  return r;
}

/** @param {CatalogDiff} r */
export function formatCatalogReport(r) {
  const lines = [];
  lines.push(`catalog-inventory: ${r.counts.livePolicies} live policies (${r.counts.chainPolicies} claimed by the chain), ${r.counts.liveFunctions} live functions (${r.counts.chainFunctions} defined by the chain), ${r.counts.liveTriggers} triggers (informational)`);
  const block = (title, items, fmt) => {
    if (!items.length) return;
    // `LABEL (n) — reason:` — the core's shape.
    const [label, reason] = title.split(' — ');
    lines.push(`\n${label} (${items.length})${reason ? ` — ${reason}` : ''}:`);
    for (const it of items) lines.push(`  ${fmt(it)}`);
  };
  block('UNOWNED POLICIES — live, but no numbered file creates them', r.unownedPolicies, p => `${p.table}.${p.name} [${p.cmd}] — ${p.why}`);
  block('STALE POLICY CLAIMS — the chain creates them, they are not live', r.stalePolicyClaims, p => `${p.table}.${p.name} [${p.cmd}] — ${p.at}`);
  block('POLICY MISMATCH — live and the chain disagree on cmd / roles / permissive', r.policyMismatch, p => `${p.table}.${p.name}: live ${p.live.cmd} to ${p.live.roles.join(',')} ${p.live.permissive} vs chain ${p.chain.cmd} to ${p.chain.roles.join(',')} ${p.chain.permissive} (${p.chain.at})`);
  block('UNOWNED FUNCTIONS — live, but no numbered file defines them', r.unownedFunctions, fn => `${fn.key} — ${fn.why}${fn.hint ? `; ${fn.hint}` : ''}${fn.owner && fn.owner !== 'postgres' ? `; owner ${fn.owner}` : ''}`);
  block('BODY DRIFT — the live body differs from the chain\'s last definition', r.bodyDrift, fn => `${fn.key} — chain ${fn.at} md5 ${fn.chainMd5} (${fn.chainBytes} bytes) vs live ${fn.liveMd5} (${fn.liveBytes} bytes)`);
  block('CONFIG DRIFT — SECURITY DEFINER / search_path differ', r.configDrift, fn => `${fn.key} — ${fn.diff.join('; ')} (chain ${fn.at})`);
  block('STALE ALLOWLIST — remove these entries', r.staleAllowlist, e => `${e.kind} ${e.kind === 'policy' ? `${e.table}.${e.name}` : `${e.name}(${e.args ?? ''})`} — ${e.why}`);
  if (r.documented.length) lines.push(`\nDocumented exceptions (allowlist): ${r.documented.length}`);
  lines.push('\nInformational:');
  block('  whitespace-only body differences (a paste artefact, not drift)', r.whitespaceOnly, fn => `  ${fn.key} — chain ${fn.at}`);
  block('  chain-only functions (created by the chain, not live — a dynamic drop, or never run)', r.chainOnlyFunctions, fn => `  ${fn.key} — ${fn.at}`);
  block('  dynamic DDL sites (EXECUTE format / string — resolved by proname literals where present)', r.dynamic, d => `  ${d.file}:${d.line} ${d.kind}${d.names.length ? ` → ${d.names.join(', ')}` : ' (no proname literal — not resolved)'}`);
  block('  non-public schema DDL (out of scope)', r.foreignSchema, s => `  ${s.file}:${s.line} ${s.statement} on ${s.table}`);
  lines.push(r.ok ? '\nOK — every live policy and function is owned or documented.' : '\nDRIFT — see above.');
  return lines.join('\n');
}
