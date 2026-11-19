import { describe, it, expect } from 'vitest';
import { SITE_FETCH_MAX_REDIRECTS, SITE_FETCH_UA, siteFetch } from '../site-fetch-server';

// Nov 18 2026: the one door to a course's website. No network here: the
// resolver and fetch are injected.

const PUBLIC = async () => [{ address: '151.101.1.67' }];
const bytes = (n: number) => new Uint8Array(n).fill(65);
const page = (body: Uint8Array | string, init: ResponseInit = {}) => new Response(body as BodyInit, { status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, ...init });

function fakeFetch(answers: Record<string, () => Response | Promise<Response>>) {
  const asked: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    asked.push({ url, init });
    const answer = answers[url];
    if (!answer) throw new TypeError('fetch failed');
    return answer();
  }) as unknown as typeof fetch;
  return { impl, asked };
}

describe('siteFetch', () => {
  it('fetches a public page with a plain crawler User-Agent, manual redirects, and no cookies or credentials', async () => {
    const { impl, asked } = fakeFetch({ 'https://www.club.com/': () => page('<p>hi</p>') });
    const r = await siteFetch('https://www.club.com/', { maxBytes: 1000 }, { fetchImpl: impl, lookup: PUBLIC });
    expect(r).toMatchObject({ ok: true, url: 'https://www.club.com/', type: 'text/html' });
    expect(r.ok && new TextDecoder().decode(r.body)).toBe('<p>hi</p>');
    const init = asked[0].init;
    expect(init.redirect).toBe('manual');
    expect(init.method).toBe('GET');
    expect(init.headers).toEqual({ 'User-Agent': SITE_FETCH_UA, Accept: '*/*' });
    expect(init.credentials).toBeUndefined();
    expect(SITE_FETCH_UA).not.toMatch(/edge|athlete|tom/i);
  });

  it('refuses a URL that is not askable before resolving or fetching anything', async () => {
    const { impl, asked } = fakeFetch({});
    let resolved = 0;
    const lookup = async () => { resolved++; return [{ address: '8.8.8.8' }]; };
    for (const u of ['http://127.0.0.1/', 'https://localhost/x', 'file:///etc/passwd', 'https://club.com:8443/', 'https://a:b@club.com/', 'nonsense']) {
      expect(await siteFetch(u, { maxBytes: 10 }, { fetchImpl: impl, lookup })).toEqual({ ok: false, reason: 'bad_url' });
    }
    expect(resolved).toBe(0);
    expect(asked).toHaveLength(0);
  });

  it('refuses a name that resolves to a private address, even when one of its addresses is public', async () => {
    const { impl, asked } = fakeFetch({ 'https://www.club.com/': () => page('x') });
    for (const set of [['10.0.0.8'], ['169.254.169.254'], ['151.101.1.67', '127.0.0.1'], ['::1'], ['fd12::1']]) {
      const r = await siteFetch('https://www.club.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: async () => set.map(address => ({ address })) });
      expect(r, set.join()).toEqual({ ok: false, reason: 'private_address' });
    }
    expect(asked).toHaveLength(0);
    expect(await siteFetch('https://www.club.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: async () => [] })).toEqual({ ok: false, reason: 'dns' });
    expect(await siteFetch('https://www.club.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: async () => { throw new Error('ENOTFOUND'); } })).toEqual({ ok: false, reason: 'dns' });
  });

  it('follows a redirect by hand and checks the new host again: a redirect to a private host is refused', async () => {
    const redirect = (to: string) => () => new Response(null, { status: 302, headers: { location: to } });
    const { impl, asked } = fakeFetch({
      'http://club.com/': redirect('https://www.club.com/golf'),
      'https://www.club.com/golf': () => page('ok'),
      'https://evil.com/': redirect('https://inside.evil.com/'),
      'https://rel.com/a/b': redirect('../c'),
      'https://rel.com/c': () => page('rel'),
      'https://meta.com/': redirect('http://169.254.169.254/latest/meta-data/'),
    });
    const lookup = async (host: string) => [{ address: host === 'inside.evil.com' ? '10.0.0.1' : '151.101.1.67' }];
    expect(await siteFetch('http://club.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup })).toMatchObject({ ok: true, url: 'https://www.club.com/golf' });
    expect(await siteFetch('https://evil.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup })).toEqual({ ok: false, reason: 'private_address' });
    expect(await siteFetch('https://rel.com/a/b', { maxBytes: 10 }, { fetchImpl: impl, lookup })).toMatchObject({ ok: true, url: 'https://rel.com/c' });
    expect(await siteFetch('https://meta.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup })).toEqual({ ok: false, reason: 'bad_url' });
    expect(asked.some(a => /inside\.evil|169\.254/.test(a.url))).toBe(false);
  });

  it('stops after a few redirects', async () => {
    const hops: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) hops[`https://loop.com/${i}`] = () => new Response(null, { status: 301, headers: { location: `/${i + 1}` } });
    const { impl, asked } = fakeFetch(hops);
    expect(await siteFetch('https://loop.com/0', { maxBytes: 10 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'too_many_redirects' });
    expect(asked).toHaveLength(SITE_FETCH_MAX_REDIRECTS + 1);
  });

  it('the size limit holds on the header and on what actually arrives', async () => {
    const { impl } = fakeFetch({
      'https://big.com/declared': () => page(bytes(10), { headers: { 'content-type': 'application/pdf', 'content-length': '5000' } }),
      'https://big.com/lying': () => page(bytes(5000), { headers: { 'content-type': 'application/pdf' } }),
      'https://big.com/fits': () => page(bytes(1000), { headers: { 'content-type': 'Application/PDF' } }),
    });
    expect(await siteFetch('https://big.com/declared', { maxBytes: 1000 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'too_large' });
    expect(await siteFetch('https://big.com/lying', { maxBytes: 1000 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'too_large' });
    const fits = await siteFetch('https://big.com/fits', { maxBytes: 1000 }, { fetchImpl: impl, lookup: PUBLIC });
    expect(fits).toMatchObject({ ok: true, type: 'application/pdf' });
    expect(fits.ok && fits.body.byteLength).toBe(1000);
  });

  it('an error status, a dead host and a timeout are refusals, never throws', async () => {
    const { impl } = fakeFetch({
      'https://gone.com/': () => new Response('no', { status: 404 }),
      'https://slow.com/': () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
      'https://bare.com/': () => new Response(null, { status: 302 }),
    });
    expect(await siteFetch('https://gone.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'http', status: 404 });
    expect(await siteFetch('https://dead.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'network' });
    expect(await siteFetch('https://slow.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'timeout' });
    expect(await siteFetch('https://bare.com/', { maxBytes: 10 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'http', status: 302 });
    expect(await siteFetch('https://gone.com/', { maxBytes: 10, timeoutMs: 0 }, { fetchImpl: impl, lookup: PUBLIC })).toEqual({ ok: false, reason: 'timeout' });
  });
});
