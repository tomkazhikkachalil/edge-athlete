// ── The launch probe's rules (Nov 2 2026) — pure, ZERO imports ──────────────
// `npm run launch:probe` reads the live state (scripts/launch-probe.mjs,
// GET requests only) and hands it here; this file decides what each row of
// docs/LAUNCH_RUNBOOK.md §0 says. Every row is ok · bad · unknown · decided
// with the evidence; the next step is the first bad row in the runbook's
// order. A DECIDED row (Nov 3 2026) is a line Tom settled by decision rather
// than by the setting the runbook first asked for — printed as `–` with the
// decision, never the next step; judged as OPEN it is a real row again.
// The runbook's wording is the source; a row here is one of its lines.

/** @typedef {{ key: string, label: string, status: 'ok'|'bad'|'unknown'|'decided', evidence: string, step: string }} Row */

export const PROD_ENV_NAMES = [
  'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM', 'CONTACT_EMAIL',
  'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT',
  'NEXT_PUBLIC_LAUNCH_GATE', 'NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES', 'NEXT_PUBLIC_OAUTH_GOOGLE',
  'ADMIN_SESSION_SECRET', 'NEXT_PUBLIC_SENTRY_DSN', 'SUPABASE_JWT_SECRET', 'CRON_SECRET',
];

export const SITE_URL = 'https://edgeathlete.ca';

const row = (key, label, status, evidence, step) => ({ key, label, status, evidence, step });
const has = (names, n) => (names ? (names.has(n) ? 'ok' : 'bad') : 'unknown');
const hasText = (names, n) => (names ? (names.has(n) ? 'set' : 'absent') : 'Vercel not read');

/**
 * @param {{
 *   auth: null | { site_url?: string, uri_allow_list?: string, mailer_autoconfirm?: boolean, disable_signup?: boolean,
 *                  smtp_host?: string|null, rate_limit_email_sent?: number, external_google_enabled?: boolean },
 *   envNames: null | Set<string>,
 *   http: { health?: { status?: string, commit?: string } | null, robots?: string | null, sitemap?: number | null,
 *           signup?: number | null, push?: { enabled?: boolean } | null, doors?: Record<string, number>, feed?: number | null },
 *   resend: null | { status?: string } | 'absent',
 *   expectOpen?: boolean,
 * }} state
 * @returns {Row[]}
 */
export function judge(state) {
  const { auth, envNames: n, http, resend, expectOpen = false } = state;
  const rows = [];

  // E-mail (§1 + §2)
  rows.push(row('resend', 'Resend domain edgeathlete.ca verified',
    resend === 'absent' || resend == null ? 'unknown' : resend.status === 'verified' ? 'ok' : 'bad',
    resend === 'absent' ? 'add RESEND_API_KEY to .env.staging to read it' : resend == null ? 'not read' : `status ${resend.status ?? '?'}`,
    '§1 Resend → Domains → Verify'));
  const smtpAll = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'EMAIL_FROM'];
  rows.push(row('smtp', 'SMTP_* + EMAIL_FROM in Vercel Production',
    n ? (smtpAll.every(k => n.has(k)) ? 'ok' : 'bad') : 'unknown',
    n ? smtpAll.map(k => `${k}:${n.has(k) ? 'set' : 'absent'}`).join(' ') : 'Vercel not read',
    '§0 E-mail → Vercel Production env'));
  rows.push(row('contact-email', 'CONTACT_EMAIL in Vercel Production', has(n, 'CONTACT_EMAIL'), hasText(n, 'CONTACT_EMAIL'), '§0 E-mail'));
  rows.push(row('auth-smtp', 'Supabase auth e-mail on custom SMTP',
    auth ? (auth.smtp_host ? 'ok' : 'bad') : 'unknown',
    auth ? (auth.smtp_host ? `smtp_host ${auth.smtp_host}` : 'built-in sender (a handful an hour)') : 'Supabase not read',
    '§2 Supabase → Authentication → SMTP'));
  rows.push(row('auth-rate', 'Supabase auth e-mail rate limit ≥ 30/h',
    auth ? ((auth.rate_limit_email_sent ?? 0) >= 30 ? 'ok' : 'bad') : 'unknown',
    auth ? `${auth.rate_limit_email_sent ?? '?'}/h` : 'Supabase not read',
    '§2 Authentication → Rate Limits'));

  // The address
  rows.push(row('site-url', `Supabase Site URL = ${SITE_URL}`,
    auth ? (auth.site_url === SITE_URL ? 'ok' : 'bad') : 'unknown',
    auth ? `site_url ${auth.site_url ?? '(unset)'}` : 'Supabase not read',
    'GO_LIVE Phase 5: Authentication → URL Configuration'));
  rows.push(row('redirects', 'Redirect allowlist names edgeathlete.ca',
    auth ? ((auth.uri_allow_list ?? '').includes('edgeathlete.ca') ? 'ok' : 'bad') : 'unknown',
    auth ? `uri_allow_list ${auth.uri_allow_list || '(empty)'}` : 'Supabase not read',
    'Authentication → URL Configuration → Redirect URLs'));

  // The sign-up path
  rows.push(row('confirmations', 'E-mail confirmations ON (Convention 56)',
    auth ? (auth.mailer_autoconfirm === false ? 'ok' : 'bad') : 'unknown',
    auth ? `mailer_autoconfirm ${auth.mailer_autoconfirm}` : 'Supabase not read',
    '§2 Authentication → Email → Confirm email ON (after the template)'));
  // The Supabase sign-up switch. Gated: Tom's decision (Nov 3 2026) is to
  // leave it ON — the app's gate answers POST /api/signup 403 and the
  // dashboard switch is the switch day's, so the row reports and never
  // nags. Open: the switch must be ON, judged like any other row.
  rows.push(expectOpen
    ? row('signups', 'Supabase sign-ups allowed',
      auth ? (auth.disable_signup === false ? 'ok' : 'bad') : 'unknown',
      auth ? `disable_signup ${auth.disable_signup}` : 'Supabase not read',
      'Authentication → "Allow new users to sign up"')
    : row('signups', 'Supabase sign-ups while gated (open by decision, Nov 3 2026)',
      auth ? 'decided' : 'unknown',
      auth ? `disable_signup ${auth.disable_signup} — the app's gate answers POST /api/signup 403; the dashboard switch is the switch day's` : 'Supabase not read',
      'The switch'));
  rows.push(row('google', 'Google provider enabled',
    auth ? (auth.external_google_enabled ? 'ok' : 'bad') : 'unknown',
    auth ? `external_google_enabled ${auth.external_google_enabled}` : 'Supabase not read', '§3'));
  rows.push(row('guardian-flag', 'NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES in Production (build-injected)',
    has(n, 'NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES'), hasText(n, 'NEXT_PUBLIC_FEATURE_GUARDIAN_PROFILES'), '§0 Sign-up path'));
  rows.push(row('google-flag', 'NEXT_PUBLIC_OAUTH_GOOGLE in Production (build-injected)',
    has(n, 'NEXT_PUBLIC_OAUTH_GOOGLE'), hasText(n, 'NEXT_PUBLIC_OAUTH_GOOGLE'), '§3'));

  // Push, the console, the secrets
  const vapid = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'];
  rows.push(row('push', 'Push keys set and /api/push/config enabled',
    http.push ? (http.push.enabled ? 'ok' : 'bad') : (n ? (vapid.every(k => n.has(k)) ? 'ok' : 'bad') : 'unknown'),
    http.push ? `enabled ${http.push.enabled}` : n ? vapid.map(k => `${k}:${n.has(k) ? 'set' : 'absent'}`).join(' ') : 'not read',
    '§0 Push keys'));
  for (const k of ['ADMIN_SESSION_SECRET', 'NEXT_PUBLIC_SENTRY_DSN', 'SUPABASE_JWT_SECRET', 'CRON_SECRET']) {
    rows.push(row(k.toLowerCase(), `${k} in Production`, has(n, k), hasText(n, k), 'Vercel → Settings → Environment Variables'));
  }

  // Live: the gate and the doors
  const gated = http.robots == null ? null : /Disallow: \/\s*$/m.test(http.robots) && !/Allow:/.test(http.robots);
  rows.push(row('health', 'Production healthy',
    http.health ? (http.health.status === 'ok' ? 'ok' : 'bad') : 'unknown',
    http.health ? `${http.health.status} ${String(http.health.commit ?? '').slice(0, 8)}` : 'not reached', 'Launch-day watch'));
  rows.push(row('gate', expectOpen ? 'Launch gate OFF (robots allow, sitemap 200, sign-up open)' : 'Launch gate ON (robots disallow, sitemap 404, sign-up 403)',
    gated == null ? 'unknown' : (expectOpen ? (!gated && http.sitemap === 200 && http.signup !== 403) : (gated && http.sitemap === 404 && http.signup === 403)) ? 'ok' : 'bad',
    `robots ${gated == null ? '?' : gated ? 'disallow' : 'allow'} · sitemap ${http.sitemap ?? '?'} · POST /api/signup ${http.signup ?? '?'}`,
    expectOpen ? 'The switch' : '§0 (gated by design until the switch)'));
  rows.push(row('gate-flag', expectOpen ? 'NEXT_PUBLIC_LAUNCH_GATE removed from Production' : 'NEXT_PUBLIC_LAUNCH_GATE in Production',
    n ? ((n.has('NEXT_PUBLIC_LAUNCH_GATE') !== expectOpen) ? 'ok' : 'bad') : 'unknown', hasText(n, 'NEXT_PUBLIC_LAUNCH_GATE'), 'The switch (a REAL build)'));
  const doors = http.doors ?? {};
  const doorKeys = Object.keys(doors);
  rows.push(row('doors', 'The visitor doors answer 200 (help, contact, privacy, terms)',
    doorKeys.length === 0 ? 'unknown' : doorKeys.every(k => doors[k] === 200) ? 'ok' : 'bad',
    doorKeys.map(k => `${k} ${doors[k]}`).join(' · ') || 'not read', '§0 Legal and the visitor doors'));

  return rows;
}

/** The first bad row, in the runbook's order; null when every row is ok, decided or unknown. */
export function nextStep(rows) {
  return rows.find(r => r.status === 'bad') ?? null;
}

export function formatRows(rows) {
  const mark = { ok: '✓', bad: '✗', unknown: '?', decided: '–' };
  const width = Math.max(...rows.map(r => r.label.length));
  return rows.map(r => `${mark[r.status]}  ${r.label.padEnd(width)}  ${r.evidence}`).join('\n');
}
