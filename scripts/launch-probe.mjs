#!/usr/bin/env node
/**
 * The launch probe (Nov 2 2026): `npm run launch:probe` — reads the LIVE
 * state behind docs/LAUNCH_RUNBOOK.md §0 and prints each line as ✓ ✗ ?,
 * then the next step in the runbook's order. READ-ONLY by construction:
 * every request is a GET except the sign-up probe's empty POST, which the
 * gate refuses (403) and which creates nothing either way. The rules are
 * scripts/launch-probe-rules.mjs (pure, tested).
 *
 * Sources: the Supabase management API (SUPABASE_ACCESS_TOKEN in
 * .env.staging — an account token; the prod ref from .env.prod the way
 * staging-sql.mjs derives it), the Vercel API (VERCEL_API_TOKEN in
 * .env.staging — a read token from vercel.com/account/tokens — or else the
 * CLI's login, whose token expires; .vercel/project.json names the project;
 * env NAMES only — a Sensitive value is never readable and never printed),
 * the live site, and Resend when RESEND_API_KEY is in .env.staging.
 *
 *   --open    judge against the OPENED state (after the switch)
 *   --json    the raw state, for the devlog
 */
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { judge, nextStep, formatRows, PROD_ENV_NAMES } from './launch-probe-rules.mjs';

const open = process.argv.includes('--open');
const asJson = process.argv.includes('--json');
const SITE = process.env.LAUNCH_PROBE_SITE ?? 'https://edgeathlete.ca';
const PROD_REF_FALLBACK = 'htwhmdoiszhhmwuflgci';

const env = {};
for (const file of ['.env.staging', '.env.prod']) {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* absent */ }
}
const prodRef = /https:\/\/([a-z0-9]+)\.supabase\.co/.exec(env.NEXT_PUBLIC_SUPABASE_URL ?? '')?.[1] ?? PROD_REF_FALLBACK;

const get = async (url, headers = {}) => {
  const res = await fetch(url, { method: 'GET', headers, redirect: 'manual' });
  return res;
};

async function readAuth() {
  const token = env.SUPABASE_ACCESS_TOKEN;
  if (!token || token.startsWith('PASTE')) return { auth: null, note: 'SUPABASE_ACCESS_TOKEN missing from .env.staging' };
  const res = await get(`https://api.supabase.com/v1/projects/${prodRef}/config/auth`, { Authorization: `Bearer ${token}` });
  if (!res.ok) return { auth: null, note: `Supabase config/auth → ${res.status}` };
  const j = await res.json();
  return { auth: {
    site_url: j.site_url, uri_allow_list: j.uri_allow_list, mailer_autoconfirm: j.mailer_autoconfirm,
    disable_signup: j.disable_signup, smtp_host: j.smtp_host ?? null, rate_limit_email_sent: j.rate_limit_email_sent,
    external_google_enabled: j.external_google_enabled, mailer_otp_exp: j.mailer_otp_exp,
  } };
}

function vercelToken() {
  if (env.VERCEL_API_TOKEN) return { token: env.VERCEL_API_TOKEN, from: 'VERCEL_API_TOKEN in .env.staging' };
  const auth = JSON.parse(readFileSync(join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'), 'utf8'));
  return { token: auth.token, from: 'the Vercel CLI login' };
}

async function readVercelEnvNames() {
  try {
    const { token, from } = vercelToken();
    const project = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
    const res = await get(`https://api.vercel.com/v9/projects/${project.projectId}/env?teamId=${project.orgId}`, { Authorization: `Bearer ${token}` });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const invalid = body?.error?.invalidToken ? ' — the token is expired or invalid: `vercel login` again, or put a read token from vercel.com/account/tokens in .env.staging as VERCEL_API_TOKEN' : '';
      return { envNames: null, note: `Vercel env → ${res.status} with ${from}${invalid}` };
    }
    const j = await res.json();
    const names = new Set((j.envs ?? []).filter(e => (e.target ?? []).includes('production')).map(e => e.key));
    return { envNames: names };
  } catch (e) {
    return { envNames: null, note: `Vercel not read (${e.message.split('\n')[0]})` };
  }
}

async function readLive() {
  const http = { doors: {} };
  try { const r = await get(`${SITE}/api/health`); http.health = await r.json().catch(() => null); } catch { http.health = null; }
  try { const r = await get(`${SITE}/robots.txt`); http.robots = r.ok ? await r.text() : null; } catch { http.robots = null; }
  try { http.sitemap = (await get(`${SITE}/sitemap.xml`)).status; } catch { http.sitemap = null; }
  try {
    const r = await fetch(`${SITE}/api/signup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    http.signup = r.status;
  } catch { http.signup = null; }
  try { const r = await get(`${SITE}/api/push/config`); http.push = r.ok ? await r.json() : null; } catch { http.push = null; }
  for (const p of ['/help', '/contact', '/privacy', '/terms']) {
    try { http.doors[p] = (await get(`${SITE}${p}`)).status; } catch { http.doors[p] = 0; }
  }
  try { http.feed = (await get(`${SITE}/feed`)).status; } catch { http.feed = null; }
  return http;
}

async function readResend() {
  const key = env.RESEND_API_KEY;
  if (!key) return 'absent';
  const res = await get('https://api.resend.com/domains', { Authorization: `Bearer ${key}` });
  if (!res.ok) return null;
  const j = await res.json();
  const d = (j.data ?? []).find(x => x.name === 'edgeathlete.ca');
  return d ? { status: d.status } : { status: 'not added' };
}

const [{ auth, note: authNote }, { envNames, note: vercelNote }, http, resend] = await Promise.all([readAuth(), readVercelEnvNames(), readLive(), readResend()]);
const state = { auth, envNames, http, resend, expectOpen: open };
const rows = judge(state);

if (asJson) {
  console.log(JSON.stringify({ ...state, envNames: envNames ? [...envNames].filter(k => PROD_ENV_NAMES.includes(k)) : null, rows }, null, 2));
} else {
  console.log(`launch-probe · ${SITE} · prod ref ${prodRef} · judged as ${open ? 'OPEN' : 'GATED'}\n`);
  if (authNote) console.log(`? ${authNote}`);
  if (vercelNote) console.log(`? ${vercelNote}`);
  console.log(formatRows(rows));
  const next = nextStep(rows);
  console.log(next ? `\nNext: ${next.label} — ${next.step}` : '\nEvery row that could be read is green.');
}
process.exit(nextStep(rows) ? 1 : 0);
