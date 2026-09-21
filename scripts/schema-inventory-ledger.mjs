/**
 * The ledger facet of `npm run check:schema` (migration 226, Round 2 —
 * Sep 21 2026): pure, unit-tested. The chain is the list of numbered file
 * names on disk; the ledger is `schema_migrations`' rows. Every chain
 * number must be in the ledger (a file that has NOT RUN here, by name) and
 * every ledger number must be a file (LEDGER-ONLY: a row for a file the
 * repo lacks — a renamed file, or a row typed by hand). A ledger row whose
 * name differs from the file's is reported too (a rename after the run).
 */

/** The chain's numbers, from file names like `226_ledger.sql`. */
export function chainNumbers(fileNames) {
  const out = new Map();
  for (const name of fileNames) {
    const m = /^(\d{3})_.*\.sql$/.exec(name);
    if (m) out.set(Number(m[1]), name);
  }
  return out;
}

export function diffLedger(fileNames, rows) {
  const chain = chainNumbers(fileNames);
  const ledger = new Map(rows.map(r => [Number(r.number), r]));
  const notRun = [...chain.entries()].filter(([n]) => !ledger.has(n)).map(([, name]) => name).sort();
  const ledgerOnly = [...ledger.values()].filter(r => !chain.has(Number(r.number))).map(r => `${r.number} (${r.name})`);
  const renamed = [...chain.entries()].filter(([n, name]) => ledger.has(n) && ledger.get(n).name !== name).map(([n, name]) => `${name} (ledger says ${ledger.get(n).name})`);
  const chainHead = Math.max(0, ...chain.keys());
  const ledgerHead = Math.max(0, ...ledger.keys());
  return { ok: notRun.length === 0 && ledgerOnly.length === 0, notRun, ledgerOnly, renamed, chainHead, ledgerHead, chainCount: chain.size, ledgerCount: ledger.size };
}

export function formatLedgerReport(r) {
  const lines = [`Ledger: ${r.ledgerCount} rows, head ${r.ledgerHead} — chain: ${r.chainCount} files, head ${r.chainHead}`];
  if (r.notRun.length) {
    lines.push(`  NOT RUN here (${r.notRun.length}) — run in the SQL editor, top to bottom:`);
    for (const n of r.notRun) lines.push(`    ${n}`);
  }
  if (r.ledgerOnly.length) {
    lines.push(`  LEDGER-ONLY (${r.ledgerOnly.length}) — a row with no file in the repo:`);
    for (const n of r.ledgerOnly) lines.push(`    ${n}`);
  }
  if (r.renamed.length) {
    lines.push(`  renamed since it ran (informational):`);
    for (const n of r.renamed) lines.push(`    ${n}`);
  }
  lines.push(r.ok ? 'Ledger OK — every file on disk has run here.' : 'Ledger DRIFT.');
  return lines.join('\n');
}
