/** The link-visibility token: 24 random bytes, URL-safe. Rotating it kills every old link. */
import { randomBytes } from 'node:crypto';

export function mintLinkToken(): string {
  return randomBytes(24).toString('base64url');
}
