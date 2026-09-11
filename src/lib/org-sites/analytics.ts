/**
 * First-party site analytics — program 2, E (Sep 11 2026). Tom's decision:
 * counts we keep ourselves, never a third party. A 1x1 GIF on every public
 * org-site page (server-rendered, no script) hits `hit.gif`; this is the
 * pure half the route and the cron share, node-tested:
 *
 * - `dayKeyUTC`: the UTC day the row is keyed by.
 * - `visitorHash`: HMAC(secret, day) is the day's salt; the mark is
 *   sha256(salt + ip + ua) — the same visitor is one mark for one day and a
 *   different, unlinkable mark the next. No IP or user agent is stored.
 * - `isBotUA`: a short denylist — crawlers and previewers are not visitors.
 * - `pathKey`: the page the pixel sat on, from the same-origin Referer:
 *   the site's home is "/", a subpage its first two segments, <= 80 chars.
 * - `optedOut`: `Sec-GPC: 1` or `DNT: 1` — nothing is counted at all.
 * - No `ANALYTICS_SALT` — nothing is counted (a supported, degraded state).
 */
import { createHash, createHmac } from 'crypto';

export function analyticsSecret(): string | null {
  return process.env.ANALYTICS_SALT || null;
}

export function dayKeyUTC(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function visitorHash(secret: string, day: string, ip: string, ua: string): string {
  const salt = createHmac('sha256', secret).update(`site-analytics:${day}`).digest();
  return createHash('sha256').update(salt).update(' ').update(ip).update(' ').update(ua).digest('hex').slice(0, 32);
}

const BOT_RE = /bot|crawl|spider|slurp|preview|headless|facebookexternalhit|whatsapp|telegram|discord|pingdom|uptime|monitor|curl\/|wget\/|python-requests|go-http-client/i;

export function isBotUA(ua: string | null): boolean {
  if (!ua || ua.trim() === '') return true;
  return BOT_RE.test(ua);
}

export function optedOut(headers: { get(name: string): string | null }): boolean {
  return headers.get('sec-gpc') === '1' || headers.get('dnt') === '1';
}

/** The page under the site's base path: "/" for the home, else "/segment"
 *  or "/segment/segment" — never a query, never a hash, at most 80 chars. */
export function pathKey(pathname: string, basePath: string): string {
  const base = basePath.replace(/\/+$/, '');
  let rest = pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  rest = rest.split('?')[0].split('#')[0];
  const segments = rest.split('/').filter(Boolean).slice(0, 2);
  const key = segments.length === 0 ? '/' : `/${segments.join('/')}`;
  return key.length > 80 ? key.slice(0, 80) : key;
}

/** The same-origin page that requested the pixel, or null (a cross-origin,
 *  missing or preview referer counts nothing). */
export function refererPath(referer: string | null, origin: string): string | null {
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.origin !== origin) return null;
    if (url.pathname.includes('/preview/')) return null;
    return url.pathname;
  } catch {
    return null;
  }
}

/** A 1x1 transparent GIF. */
export const PIXEL_GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

/** The retention the daily cron applies. */
export const ANALYTICS_RETENTION_DAYS = { marks: 2, daily: 400 } as const;
export function analyticsPruneCutoffs(now: Date): { marksBefore: string; dailyBefore: string } {
  const day = 24 * 60 * 60 * 1000;
  return {
    marksBefore: dayKeyUTC(new Date(now.getTime() - ANALYTICS_RETENTION_DAYS.marks * day)),
    dailyBefore: dayKeyUTC(new Date(now.getTime() - ANALYTICS_RETENTION_DAYS.daily * day)),
  };
}
