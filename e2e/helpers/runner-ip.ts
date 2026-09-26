import { E2E_BASE_URL } from './qa-user';

// The runner's own public address(es) — test-only (gaps round, Sep 26 2026).
// A deployed target keys an anonymous per-IP bucket (`site-form`, 5 / 10 min)
// on the first x-forwarded-for hop, i.e. THIS machine's public IP, which a
// spec resetting only ::1 / 127.0.0.1 never clears — so a retry inside the
// window met its own first attempt's hits. Both families: Vercel may see
// either. A lookup that fails returns nothing and the spec carries on (the
// reset is a belt, never a gate). Localhost needs none of it.
export async function runnerPublicIps(): Promise<string[]> {
  if (E2E_BASE_URL.includes('localhost')) return [];
  const lookups = ['https://api.ipify.org', 'https://api64.ipify.org'].map(async url => {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
      const ip = res.ok ? (await res.text()).trim() : '';
      return /^[0-9a-fA-F:.]{3,45}$/.test(ip) ? ip : null;
    } catch {
      return null;
    }
  });
  return [...new Set((await Promise.all(lookups)).filter((ip): ip is string => !!ip))];
}
