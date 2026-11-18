#!/usr/bin/env node
// The dependency-advisory gate (hardening guardrail 6): `npm audit` on the
// production dependencies, judged by scripts/audit-gate-rules.mjs. Exit 0 =
// no high / critical advisory outside a live exemption; 1 = an advisory, or
// an exemption that has lapsed; 2 = the audit itself could not be read (a
// failure too: an unread audit is never a pass).
import { execFileSync } from 'node:child_process';
import { EXEMPT, auditVerdict } from './audit-gate-rules.mjs';

function npm(args) {
  try {
    return execFileSync('npm', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    // `npm audit` exits non-zero whenever it finds anything; the report is on stdout.
    return typeof e.stdout === 'string' ? e.stdout : '';
  }
}

let report;
try {
  report = JSON.parse(npm(['audit', '--omit=dev', '--json']));
} catch {
  console.log('audit-gate: npm audit gave no readable report');
  process.exit(2);
}
if (report.error) {
  console.log(`audit-gate: npm audit failed: ${report.error.summary ?? report.error.code ?? 'unknown error'}`);
  process.exit(2);
}

const latest = {};
for (const pkg of new Set(EXEMPT.map(e => e.pkg))) {
  const v = npm(['view', pkg, 'version']).trim();
  latest[pkg] = /^\d+\.\d+\.\d+/.test(v) ? v : null;
}

const verdict = auditVerdict(report, { today: new Date().toISOString().slice(0, 10), latest });
for (const a of verdict.exempted) {
  console.log(`EXEMPT ${a.id} (${a.pkg}, ${a.severity}) until ${a.exemption.expires} or the next ${a.pkg} release: ${a.exemption.reason}`);
}
for (const a of verdict.lapsed) console.log(`LAPSED ${a.id} (${a.pkg}, ${a.severity}): ${a.why}`);
for (const a of verdict.failing) console.log(`FAIL ${a.id} (${a.pkg}, ${a.severity}): ${a.title}`);
process.exit(verdict.ok ? 0 : 1);
