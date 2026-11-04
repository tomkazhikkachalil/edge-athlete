import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { judge, nextStep, formatRows, PROD_ENV_NAMES, SITE_URL } from '../../../scripts/launch-probe-rules.mjs';

// The launch probe (Nov 2 2026): the rules behind `npm run launch:probe`.
const green = () => ({
  auth: { site_url: SITE_URL, uri_allow_list: 'https://edgeathlete.ca/**,https://edge-athlete.vercel.app/**', mailer_autoconfirm: false, disable_signup: true, smtp_host: 'smtp.resend.com' as string | null, rate_limit_email_sent: 60, external_google_enabled: true },
  envNames: new Set(PROD_ENV_NAMES),
  http: { health: { status: 'ok', commit: 'abc' }, robots: 'User-agent: *\nDisallow: /\n', sitemap: 404, signup: 403, push: { enabled: true }, doors: { '/help': 200, '/contact': 200, '/privacy': 200, '/terms': 200 }, feed: 307 },
  resend: { status: 'verified' },
});

describe('the launch probe rules', () => {
  it('a fully green gated state has no next step; the sign-up switch is a decided row, not a judged one', () => {
    const rows = judge(green());
    expect(rows.every(r => r.status === 'ok' || r.key === 'signups'), formatRows(rows)).toBe(true);
    expect(rows.find(r => r.key === 'signups')?.status).toBe('decided');
    expect(nextStep(rows)).toBeNull();
    expect(formatRows(rows)).toMatch(/^–  Supabase sign-ups while gated/m);
  });
  it('gated, the sign-up switch is never the next step whichever way it points (Tom, Nov 3 2026)', () => {
    for (const disable_signup of [true, false]) {
      const s = green(); s.auth.disable_signup = disable_signup;
      const rows = judge(s);
      const r = rows.find(x => x.key === 'signups');
      expect(r?.status, String(disable_signup)).toBe('decided');
      expect(r?.evidence).toContain(`disable_signup ${disable_signup}`);
      expect(r?.evidence).toContain('403');
      expect(nextStep(rows)).toBeNull();
    }
  });
  it('judged as OPEN, a closed sign-up switch is a real hole and the next step', () => {
    const s = green();
    s.http.robots = 'User-agent: *\nAllow: /\nDisallow: /api/\n'; s.http.sitemap = 200; s.http.signup = 400;
    s.envNames.delete('NEXT_PUBLIC_LAUNCH_GATE'); s.auth.disable_signup = true;
    const rows = judge({ ...s, expectOpen: true });
    expect(nextStep(rows)?.key).toBe('signups');
    expect(rows.find(r => r.key === 'signups')?.status).toBe('bad');
  });
  it('each single hole names its own runbook line, in the runbook order', () => {
    const cases: Array<[string, (s: ReturnType<typeof green>) => void]> = [
      ['resend', s => { s.resend = { status: 'pending' }; }],
      ['smtp', s => { s.envNames.delete('SMTP_PASS'); }],
      ['auth-smtp', s => { s.auth.smtp_host = null; }],
      ['auth-rate', s => { s.auth.rate_limit_email_sent = 2; }],
      ['site-url', s => { s.auth.site_url = 'https://edge-athlete.vercel.app'; }],
      ['confirmations', s => { s.auth.mailer_autoconfirm = true; }],
      ['push', s => { s.http.push = { enabled: false }; }],
      ['admin_session_secret', s => { s.envNames.delete('ADMIN_SESSION_SECRET'); }],
      ['gate', s => { s.http.signup = 400; }],
      ['doors', s => { s.http.doors['/contact'] = 307; }],
    ];
    for (const [key, poke] of cases) {
      const s = green(); poke(s);
      const rows = judge(s);
      expect(nextStep(rows)?.key, key).toBe(key);
      expect(rows.filter(r => r.status === 'bad').map(r => r.key), key).toEqual([key]);
    }
  });
  it('what cannot be read is unknown, never bad, and never the next step', () => {
    const rows = judge({ auth: null, envNames: null, http: { doors: {} }, resend: 'absent' });
    expect(rows.some(r => r.status === 'bad')).toBe(false);
    expect(nextStep(rows)).toBeNull();
    expect(rows.find(r => r.key === 'resend')?.evidence).toContain('RESEND_API_KEY');
  });
  it('judged as OPEN, the gate rows flip', () => {
    const s = green();
    s.http.robots = 'User-agent: *\nAllow: /\nDisallow: /api/\n'; s.http.sitemap = 200; s.http.signup = 400;
    s.envNames.delete('NEXT_PUBLIC_LAUNCH_GATE'); s.auth.disable_signup = false;
    const rows = judge({ ...s, expectOpen: true });
    expect(nextStep(rows), formatRows(rows)).toBeNull();
  });
  it('the script is read-only: no POST but the sign-up refusal, no PATCH, PUT or DELETE; the rules import nothing', () => {
    const script = fs.readFileSync(path.join(process.cwd(), 'scripts/launch-probe.mjs'), 'utf8');
    expect(script.match(/method: 'POST'/g)?.length ?? 0).toBe(1);
    expect(script).not.toMatch(/method: '(PATCH|PUT|DELETE)'/);
    expect(script).toContain('/api/signup');
    const rules = fs.readFileSync(path.join(process.cwd(), 'scripts/launch-probe-rules.mjs'), 'utf8');
    expect(rules).not.toMatch(/^import /m);
    expect(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8')).toContain('"launch:probe": "node scripts/launch-probe.mjs"');
  });
});
