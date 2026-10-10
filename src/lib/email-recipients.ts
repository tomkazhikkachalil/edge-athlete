/**
 * Addresses no mail can reach, by standard (RFC 2606 / 6761): example.com /
 * .net / .org and the .test / .example / .invalid / .localhost top-level
 * domains — the e2e suite's QA accounts and a departed account's
 * `<id>@departed.invalid` live there. Pure; zero imports.
 *
 * A send to ONLY such addresses is skipped quietly (email-service.ts
 * `deliver`): the mail provider refuses them with a 550 that used to be
 * logged as an error on every QA run (the Oct 9 2026 log sweep).
 */
const RESERVED_DOMAINS = new Set(['example.com', 'example.net', 'example.org']);
const RESERVED_TLDS = new Set(['test', 'example', 'invalid', 'localhost']);

/** The bare address inside `Name <a@b.c>`, lowercased; '' when none. */
function bare(address: string): string {
  const m = /<([^>]+)>/.exec(address);
  return (m ? m[1] : address).trim().toLowerCase();
}

export function isReservedAddress(address: string): boolean {
  const at = bare(address).lastIndexOf('@');
  if (at < 0) return false;
  const domain = bare(address).slice(at + 1).replace(/\.$/, '');
  if (RESERVED_DOMAINS.has(domain)) return true;
  for (const d of RESERVED_DOMAINS) if (domain.endsWith(`.${d}`)) return true;
  const tld = domain.split('.').pop() ?? '';
  return RESERVED_TLDS.has(tld);
}

/** Flatten nodemailer's `to` / `cc` / `bcc` shapes (a string, a comma list,
 *  an `{ address }` object, or an array of those) into bare address strings. */
export function recipientList(...fields: unknown[]): string[] {
  const out: string[] = [];
  for (const f of fields) {
    for (const r of Array.isArray(f) ? f : [f]) {
      if (typeof r === 'string') out.push(...r.split(',').map(s => s.trim()).filter(Boolean));
      else if (r && typeof r === 'object' && typeof (r as { address?: unknown }).address === 'string') out.push((r as { address: string }).address);
    }
  }
  return out;
}

/** True when there is at least one recipient and every one is reserved. */
export function onlyReservedRecipients(addresses: string[]): boolean {
  return addresses.length > 0 && addresses.every(isReservedAddress);
}
