// ── The fetcher for a course's own website (Nov 18 2026) ─────────────────────
// A website address in the catalog is somebody else's text (OSM, a provider).
// This is the only door through which the scorecard reader asks for one, and
// it is narrow on purpose:
//   • http(s), a real host name, the default port (isFetchableUrl)
//   • every address the name resolves to is public (isPublicAddress), checked
//     again on every redirect hop; redirects are followed by hand, a few only
//   • a time limit and a size limit, enforced while the body is read
//   • a plain crawler User-Agent that names no person and no project
// One limit is known and accepted: the name is resolved here and again by
// fetch, so a host that answers the two lookups differently could slip a
// private address past the check. A function has no private network worth
// reaching and no credentials are ever sent; the check is against mistakes
// and casual abuse, not a determined resolver.

import { lookup as dnsLookup } from 'node:dns/promises';
import { isFetchableUrl, isPublicAddress } from '@/lib/golf/site-card';

export const SITE_FETCH_UA = 'Mozilla/5.0 (compatible; course-scorecard-reader/1.0)';
export const SITE_FETCH_TIMEOUT_MS = 12_000;
export const SITE_FETCH_MAX_REDIRECTS = 3;
export const SITE_PAGE_MAX_BYTES = 1_500_000;
export const SITE_FILE_MAX_BYTES = 8_000_000;

export type SiteFetchRefusal = 'bad_url' | 'private_address' | 'dns' | 'too_many_redirects' | 'timeout' | 'too_large' | 'http' | 'network';

export type SiteFetchResult =
  | { ok: true; url: string; type: string; body: Uint8Array }
  | { ok: false; reason: SiteFetchRefusal; status?: number };

export interface SiteFetchDeps {
  fetchImpl?: typeof fetch;
  lookup?: (host: string) => Promise<Array<{ address: string }>>;
}

const defaultLookup = (host: string) => dnsLookup(host, { all: true });

/** One GET of a public page or file. Never throws: a refusal says why. */
export async function siteFetch(
  url: string,
  opts: { maxBytes: number; timeoutMs?: number; accept?: string },
  deps: SiteFetchDeps = {}
): Promise<SiteFetchResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const lookup = deps.lookup ?? defaultLookup;
  const deadline = Date.now() + (opts.timeoutMs ?? SITE_FETCH_TIMEOUT_MS);
  let current = url;
  for (let hop = 0; hop <= SITE_FETCH_MAX_REDIRECTS; hop++) {
    if (!isFetchableUrl(current)) return { ok: false, reason: 'bad_url' };
    let addresses: Array<{ address: string }>;
    try { addresses = await lookup(new URL(current).hostname); } catch { return { ok: false, reason: 'dns' }; }
    if (addresses.length === 0) return { ok: false, reason: 'dns' };
    if (!addresses.every(a => isPublicAddress(a.address))) return { ok: false, reason: 'private_address' };
    const left = deadline - Date.now();
    if (left <= 0) return { ok: false, reason: 'timeout' };
    let res: Response;
    try {
      res = await fetchImpl(current, {
        method: 'GET',
        redirect: 'manual',
        headers: { 'User-Agent': SITE_FETCH_UA, Accept: opts.accept ?? '*/*' },
        signal: AbortSignal.timeout(left),
        cache: 'no-store',
      });
    } catch (e) {
      return { ok: false, reason: (e as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get('location');
      await res.body?.cancel().catch(() => undefined);
      if (!next) return { ok: false, reason: 'http', status: res.status };
      try { current = new URL(next, current).href; } catch { return { ok: false, reason: 'bad_url' }; }
      continue;
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'http', status: res.status };
    }
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > opts.maxBytes) {
      await res.body?.cancel().catch(() => undefined);
      return { ok: false, reason: 'too_large' };
    }
    // The limit is enforced on what arrives, whatever the header said.
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      const reader = res.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > opts.maxBytes) {
            await reader.cancel().catch(() => undefined);
            return { ok: false, reason: 'too_large' };
          }
          chunks.push(value);
        }
      }
    } catch (e) {
      return { ok: false, reason: (e as { name?: string })?.name === 'TimeoutError' ? 'timeout' : 'network' };
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const c of chunks) { body.set(c, offset); offset += c.byteLength; }
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
    return { ok: true, url: current, type, body };
  }
  return { ok: false, reason: 'too_many_redirects' };
}
