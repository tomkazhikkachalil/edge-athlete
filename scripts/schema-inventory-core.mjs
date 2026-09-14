/**
 * Schema provenance — the pure core (data foundation, P1 — Sep 13 2026).
 *
 * The rule: every LIVE table and column is named by a numbered migration in
 * database/migrations/, or by a documented entry in
 * database/provenance/allowlist.json. This module is the parser and the
 * diff; scripts/schema-inventory.mjs is the runner (it fetches PostgREST's
 * OpenAPI definitions with the service key and calls in here). No I/O, no
 * dependencies — node-only vitest imports it (the browser-floor precedent).
 *
 * Ownership, as the parser reads it:
 *  • a table is OWNED when a numbered file `CREATE TABLE [IF NOT EXISTS]`s
 *    it (its inline columns are owned with it), or `CREATE VIEW`s it — an
 *    `ALTER TABLE` on a table the chain never created does NOT own the
 *    table (the columns it adds are remembered, and count once the
 *    baseline creates the table);
 *  • a column is OWNED when a `CREATE TABLE` body names it, or an
 *    `ALTER TABLE … ADD [COLUMN] [IF NOT EXISTS]` adds it, or a
 *    `RENAME COLUMN … TO` produces it (the old name is disowned), and it
 *    has not been `DROP COLUMN`ed later in the chain;
 *  • comments and dollar-quoted FUNCTION bodies are ignored; the bodies of
 *    `DO $$ … $$` blocks are KEPT (guarded ALTERs live there).
 * A mention is not ownership: a policy or an index naming a column does not
 * define it. That is the whole point — the crude "is the word in a file
 * that mentions the table" check passed columns that nothing creates.
 */

const CONSTRAINT_LEADERS = /^(constraint|primary\s+key|unique|check|foreign\s+key|exclude|like)\b/i;

/** Strip `--` and `/* *\/` comments (outside string literals — good enough
 *  for migration SQL, which never puts `--` inside a literal). */
export function stripComments(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const two = sql.slice(i, i + 2);
    if (two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl === -1 ? sql.length : nl;
      continue;
    }
    if (two === '/*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
      continue;
    }
    if (sql[i] === "'") {
      const end = closingQuote(sql, i);
      out += sql.slice(i, end + 1);
      i = end + 1;
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

export function closingQuote(sql, start) {
  let i = start + 1;
  while (i < sql.length) {
    if (sql[i] === "'") {
      if (sql[i + 1] === "'") {
        i += 2;
        continue;
      }
      return i;
    }
    i++;
  }
  return sql.length - 1;
}

/** Replace dollar-quoted bodies (`$$ … $$`, `$tag$ … $tag$`) with a space,
 *  EXCEPT the body of a `DO` block, which stays (it holds plain DDL). */
export function stripDollarBodies(sql) {
  const re = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/g;
  let out = '';
  let last = 0;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const tag = m[0];
    const bodyStart = m.index + tag.length;
    const close = sql.indexOf(tag, bodyStart);
    if (close === -1) break;
    const before = sql.slice(last, m.index);
    const isDo = /\bdo\s*$/i.test(before.replace(/\s+/g, ' ').trimEnd());
    out += before;
    out += isDo ? ` ${sql.slice(bodyStart, close)} ` : ' ';
    last = close + tag.length;
    re.lastIndex = last;
  }
  return out + sql.slice(last);
}

/** Split on `;` outside parentheses and string literals. */
export function splitStatements(sql) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      const end = closingQuote(sql, i);
      cur += sql.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth = Math.max(0, depth - 1);
    if (ch === ';' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** `"Quoted"` → quoted (kept as is, lowercased); `public.t` → `t`; case-folded. */
export function ident(raw) {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  s = s.toLowerCase();
  if (s.startsWith('public.')) s = s.slice(7);
  if (s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1);
  return s;
}

const IDENT = String.raw`(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[^"]+"|[A-Za-z_][A-Za-z0-9_]*))?`;

/** Split a parenthesised body on top-level commas. */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === "'") {
      const end = closingQuote(body, i);
      cur += body.slice(i, end + 1);
      i = end;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

/** The text inside the first balanced parenthesis starting at `open`. */
function balanced(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "'") {
      i = closingQuote(text, i);
      continue;
    }
    if (text[i] === '(') depth++;
    if (text[i] === ')') {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/**
 * Parse the numbered chain. `files` = [{ name, sql }] in chain order.
 * Returns { tables: Map<table, Set<column>> (created by the chain), altered: Map (only ALTERed),
 *           views: Set<view>, functions: Set<fn> }.
 */
export function parseChain(files) {
  const tables = new Map();   // created by the chain (CREATE TABLE) → its owned columns
  const altered = new Map();  // only ALTERed by the chain → the columns it added (the table itself is NOT owned)
  const views = new Set();
  const functions = new Set();
  const own = t => {
    if (!tables.has(t)) {
      // The baseline CREATE comes AFTER the chain's ALTERs on a pre-chain
      // table: the columns those ALTERs added are owned with it.
      tables.set(t, new Set(altered.get(t) ?? []));
      altered.delete(t);
    }
    return tables.get(t);
  };
  const colsOf = t => {
    if (tables.has(t)) return tables.get(t);
    if (!altered.has(t)) altered.set(t, new Set());
    return altered.get(t);
  };
  for (const f of files) {
    const cleaned = stripDollarBodies(stripComments(f.sql));
    for (const st of splitStatements(cleaned)) {
      // A statement inside a kept DO block arrives with PL/pgSQL around it
      // (`do begin …`, `if not exists (…) then alter …`, `end if`): strip
      // those prefixes so the DDL matchers below see the statement itself.
      const s = st
        .replace(/\s+/g, ' ')
        .replace(/^(?:do\s+|declare\s+.*?\s+(?=begin\s)|begin\s+|if\s+.*?\s+then\s+|elsif\s+.*?\s+then\s+|else\s+|end\s+if\s*|end\s*loop\s*|end\s*)+/i, '');
      let m;
      if ((m = new RegExp(String.raw`^create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?(${IDENT})\s*(\(|as\b)`, 'i').exec(s))) {
        const t = ident(m[1]);
        const cols = own(t);
        if (m[2] === '(') {
          const open = s.indexOf('(', m.index + m[0].length - 1);
          for (const entry of splitTopLevel(balanced(s, open))) {
            if (!entry || CONSTRAINT_LEADERS.test(entry)) continue;
            const c = new RegExp(`^(${IDENT})`).exec(entry);
            if (c) cols.add(ident(c[1]));
          }
        }
        continue;
      }
      if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?(?:materialized\s+)?view\s+(?:if\s+not\s+exists\s+)?(${IDENT})`, 'i').exec(s))) {
        views.add(ident(m[1]));
        continue;
      }
      if ((m = new RegExp(String.raw`^create\s+(?:or\s+replace\s+)?function\s+(${IDENT})`, 'i').exec(s))) {
        functions.add(ident(m[1]));
        continue;
      }
      if ((m = new RegExp(String.raw`^alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(${IDENT})\s+(.*)$`, 'i').exec(s))) {
        const t = ident(m[1]);
        const cols = colsOf(t);
        for (const action of splitTopLevel(m[2])) {
          let a;
          // `ADD CONSTRAINT …` (the guarded form the baselines use) names no column.
          if (/^add\s+constraint\b/i.test(action)) continue;
          if ((a = new RegExp(String.raw`^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?(${IDENT})`, 'i').exec(action))) cols.add(ident(a[1]));
          else if ((a = new RegExp(String.raw`^rename\s+(?:column\s+)?(${IDENT})\s+to\s+(${IDENT})`, 'i').exec(action))) {
            cols.delete(ident(a[1]));
            cols.add(ident(a[2]));
          } else if ((a = new RegExp(String.raw`^drop\s+(?:column\s+)?(?:if\s+exists\s+)?(${IDENT})`, 'i').exec(action))) cols.delete(ident(a[1]));
          else if ((a = new RegExp(String.raw`^rename\s+to\s+(${IDENT})`, 'i').exec(action))) {
            const store = tables.has(t) ? tables : altered;
            store.set(ident(a[1]), cols);
            store.delete(t);
          }
        }
        continue;
      }
      if ((m = new RegExp(String.raw`^drop\s+table\s+(?:if\s+exists\s+)?(${IDENT})`, 'i').exec(s))) {
        tables.delete(ident(m[1]));
        altered.delete(ident(m[1]));
      }
    }
  }
  return { tables, altered, views, functions };
}

/** PostgREST's OpenAPI → { table: [column, …] } and the RPC names. */
export function liveFromOpenApi(spec) {
  const tables = {};
  for (const [name, def] of Object.entries(spec.definitions ?? {})) tables[name] = Object.keys(def.properties ?? {});
  const rpcs = Object.keys(spec.paths ?? {})
    .filter(p => p.startsWith('/rpc/'))
    .map(p => p.slice(5))
    .sort();
  return { tables, rpcs };
}

/**
 * The diff. `live` = { table: [columns] }; `owned` = parseChain(...);
 * `allowlist` = [{ table, column: null | name, reason, ref }].
 * A whole-table entry (column null) covers every column of that table.
 */
export function diff(live, owned, allowlist = []) {
  const allowTable = new Set(allowlist.filter(e => e.column === null || e.column === undefined).map(e => e.table));
  const allowCol = new Set(allowlist.filter(e => e.column).map(e => `${e.table}.${e.column}`));
  const unownedTables = [];
  const unownedColumns = [];
  const documented = [];
  for (const [table, cols] of Object.entries(live)) {
    const ownedCols = owned.tables.get(table);
    if (!ownedCols && !owned.views.has(table)) {
      // Only ALTERed (or never named): the table itself has no creator in the chain.
      if (allowTable.has(table)) documented.push({ table, column: null });
      else unownedTables.push(table);
      continue;
    }
    if (owned.views.has(table) && !ownedCols) continue;
    for (const col of cols) {
      if (ownedCols.has(col)) continue;
      if (allowTable.has(table) || allowCol.has(`${table}.${col}`)) documented.push({ table, column: col });
      else unownedColumns.push({ table, column: col });
    }
  }
  // Stale: an allowlist entry whose object is now owned, or is no longer live.
  const staleAllowlist = [];
  for (const e of allowlist) {
    const liveCols = live[e.table];
    if (!liveCols) {
      staleAllowlist.push({ ...e, why: 'not live' });
      continue;
    }
    const ownedCols = owned.tables.get(e.table);
    if (e.column === null || e.column === undefined) {
      // A whole-table entry stays valid while the chain does not CREATE the table.
      if (ownedCols || owned.views.has(e.table)) staleAllowlist.push({ ...e, why: 'table is owned now' });
    } else if (!liveCols.includes(e.column)) staleAllowlist.push({ ...e, why: 'column not live' });
    else if (ownedCols && ownedCols.has(e.column)) staleAllowlist.push({ ...e, why: 'column is owned now' });
  }
  return { unownedTables: unownedTables.sort(), unownedColumns, documented, staleAllowlist, ok: unownedTables.length === 0 && unownedColumns.length === 0 && staleAllowlist.length === 0 };
}

export function formatReport(result, opts = {}) {
  const lines = [];
  const liveCount = opts.liveTables ?? null;
  lines.push(`schema-inventory: ${liveCount !== null ? `${liveCount} live tables, ` : ''}${opts.ownedTables ?? '?'} owned by the chain`);
  if (result.unownedTables.length) {
    lines.push(`\nUNOWNED TABLES (${result.unownedTables.length}) — no numbered migration creates them:`);
    for (const t of result.unownedTables) lines.push(`  ${t}`);
  }
  if (result.unownedColumns.length) {
    lines.push(`\nUNOWNED COLUMNS (${result.unownedColumns.length}) — live, but no numbered migration adds them:`);
    for (const c of result.unownedColumns) lines.push(`  ${c.table}.${c.column}`);
  }
  if (result.staleAllowlist.length) {
    lines.push(`\nSTALE ALLOWLIST (${result.staleAllowlist.length}) — remove these entries:`);
    for (const e of result.staleAllowlist) lines.push(`  ${e.table}${e.column ? '.' + e.column : ''} — ${e.why}`);
  }
  if (result.documented.length) lines.push(`\nDocumented exceptions (allowlist): ${result.documented.length}`);
  if (opts.rpcs?.length) lines.push(`\nLive RPCs (informational — function provenance is a separate pass): ${opts.rpcs.length}`);
  lines.push(result.ok ? '\nOK — every live table and column is owned or documented.' : '\nDRIFT — see above.');
  return lines.join('\n');
}
