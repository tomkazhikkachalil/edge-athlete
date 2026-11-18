// The dependency-advisory gate's rules (hardening guardrail 6) — pure.
//
// The gate fails on ANY high or critical advisory in production dependencies.
// The one way past it is an entry in EXEMPT: exactly one advisory id, with a
// reason, and two things that end it on their own:
//   expires         a date. After it the exemption no longer counts and the
//                   gate fails until a person looks again.
//   lastVulnerable  the newest version of the package that existed when the
//                   exemption was written. The day the registry's latest
//                   differs, the exemption lapses: a release has shipped, so
//                   upgrade (or re-check and renew), never coast.
// An exemption is only for an advisory with NO patched version that does not
// reach this app. Tom approves each one (Nov 17 2026).

/** @typedef {{ id: string, pkg: string, since: string, expires: string, lastVulnerable: string, reason: string }} Exemption */

/** @type {Exemption[]} */
export const EXEMPT = [
  {
    id: 'GHSA-fc5q-39xc-vjpf',
    pkg: 'picomatch',
    since: '2026-11-17',
    expires: '2026-12-17',
    lastVulnerable: '4.0.7',
    reason:
      'ReDoS on an attacker-supplied glob PATTERN; no patched version exists (<= 4.0.7, the latest). Checked Nov 17 2026: the package arrives only through @sentry/nextjs -> @rollup/plugin-commonjs (its build-time loader); none of the 698 function traces of a production build includes it, no bundle contains it, and no app code imports it.',
  },
];

/**
 * The high / critical advisories of an `npm audit --json` report, split into
 * the ones that fail the gate, the ones a live exemption covers, and the
 * exemptions that have lapsed (which fail it too).
 *
 * @param {{ vulnerabilities?: Record<string, { via?: unknown[] }> } | null | undefined} report
 * @param {{ today: string, latest: Record<string, string | null | undefined>, exempt?: Exemption[] }} ctx
 *   today = YYYY-MM-DD; latest = the registry's newest version per exempted package.
 */
export function auditVerdict(report, ctx) {
  const exempt = ctx.exempt ?? EXEMPT;
  /** @type {Map<string, { id: string, pkg: string, severity: string, title: string }>} */
  const seen = new Map();
  for (const v of Object.values(report?.vulnerabilities ?? {})) {
    for (const via of v.via ?? []) {
      if (typeof via !== 'object' || !via) continue;
      const a = /** @type {{ url?: string, severity?: string, name?: string, title?: string, source?: number }} */ (via);
      if (a.severity !== 'high' && a.severity !== 'critical') continue;
      const id = String(a.url ?? '').split('/').pop() || String(a.source ?? a.title ?? 'unknown');
      seen.set(id, { id, pkg: String(a.name ?? ''), severity: a.severity, title: String(a.title ?? '') });
    }
  }
  /** @type {Array<{ id: string, pkg: string, severity: string, title: string }>} */
  const failing = [];
  /** @type {Array<{ id: string, pkg: string, severity: string, title: string, exemption: Exemption }>} */
  const exempted = [];
  /** @type {Array<{ id: string, pkg: string, severity: string, title: string, exemption: Exemption, why: string }>} */
  const lapsed = [];
  for (const a of seen.values()) {
    // The id AND the package must both match: an exemption never widens.
    const e = exempt.find(x => x.id === a.id && x.pkg === a.pkg);
    if (!e) { failing.push(a); continue; }
    const latest = ctx.latest[e.pkg];
    if (ctx.today > e.expires) lapsed.push({ ...a, exemption: e, why: `the exemption expired on ${e.expires}` });
    else if (!latest) lapsed.push({ ...a, exemption: e, why: `the registry's latest ${e.pkg} could not be read` });
    else if (latest !== e.lastVulnerable) lapsed.push({ ...a, exemption: e, why: `${e.pkg} ${latest} has been released (the exemption was written against ${e.lastVulnerable}): upgrade, then remove the exemption` });
    else exempted.push({ ...a, exemption: e });
  }
  return { failing, exempted, lapsed, ok: failing.length === 0 && lapsed.length === 0 };
}
