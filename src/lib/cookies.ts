/**
 * Parse a raw Cookie request header into a name → value map.
 *
 * Extracted from getServerClient (auth-server.ts) so the one cookie parser
 * every API route now shares is a pure, node-testable function. The previous
 * inline version had two real bugs (DEVLOG "logged, unfixed" since July):
 *
 *   - `cookie.split('=')` dropped everything after a second `=`, truncating
 *     any value containing one — base64 padding being the canonical case.
 *     Values are split on the FIRST `=` only.
 *   - `decodeURIComponent` threw on a malformed `%` sequence, which turned a
 *     single bad cookie from any source into a 500 on every request. Decoding
 *     now falls back to the raw value.
 *
 * Fragments without `=` are skipped (the spec requires name=value; browsers
 * shouldn't send them, but a hand-built client might).
 */
export function parseCookieHeader(header: string): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const fragment of header.split(';')) {
    const eq = fragment.indexOf('=');
    if (eq === -1) continue;
    const name = fragment.slice(0, eq).trim();
    if (!name) continue;
    const rawValue = fragment.slice(eq + 1).trim();
    let value: string;
    try {
      value = decodeURIComponent(rawValue);
    } catch {
      value = rawValue;
    }
    cookies[name] = value;
  }
  return cookies;
}
