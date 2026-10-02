/**
 * The VAPID public key travels as base64url text; `pushManager.subscribe`
 * wants its 65 raw bytes. Pure — no atob (node tests), no Buffer (browsers).
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error('Not a base64url string');
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  const out = new Uint8Array(new ArrayBuffer(bytes.length));
  out.set(bytes);
  return out;
}
