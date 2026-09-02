/**
 * Custom domains — the PURE half (phase 6b C1). Zero framework imports,
 * node-tested; the server half (domain-server.ts) does DNS, Vercel and
 * the database.
 *
 * An org may point its OWN domain (kmha.ca) at its Edge Athlete site.
 * The lifecycle, each step a proof the previous one really happened:
 *   none → pending (claimed; a verification token minted)
 *        → verified (the TXT record carried the token — ownership)
 *        → attached (Vercel accepted the domain for this project)
 *        → active (the domain answered /.well-known/edge-athlete with
 *          this slug — it actually routes here; only now may the apex
 *          301 to it, so a half-configured domain can never strand a
 *          visitor: no dead ends).
 *   failed = Vercel refused the attach (detail carries their reason).
 */

export const DOMAIN_MAX = 253;
export const VERIFICATION_RECORD_PREFIX = '_edgeathlete';
export const VERCEL_CNAME_TARGET = 'cname.vercel-dns.com';
export const WELL_KNOWN_PATH = '/.well-known/edge-athlete';

const HOSTNAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/** Lowercase, strip scheme/path/port/whitespace/trailing dot. */
export function normalizeHostname(input: string): string {
  let v = input.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, '');
  v = v.split('/')[0].split('?')[0].split('#')[0];
  v = v.split(':')[0];
  return v.replace(/\.$/, '');
}

export function isValidCustomDomain(host: string): boolean {
  return host.length <= DOMAIN_MAX && HOSTNAME_RE.test(host);
}

/** Hosts an org may never claim: our apex and anything under it, Vercel's
 *  own suffixes, localhost, the database host, and bare TLD-less labels. */
export function isReservedDomain(host: string, appHost: string): boolean {
  const apex = appHost.toLowerCase().split(':')[0];
  if (host === apex || host.endsWith(`.${apex}`)) return true;
  const apexRoot = apex.split('.').slice(-2).join('.');
  if (apexRoot && (host === apexRoot || host.endsWith(`.${apexRoot}`))) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.vercel.app') || host.endsWith('.vercel-dns.com')) return true;
  if (host.endsWith('.supabase.co') || host.endsWith('.supabase.in')) return true;
  return false;
}

export function verificationRecordName(host: string): string {
  return `${VERIFICATION_RECORD_PREFIX}.${host}`;
}

export type DomainState =
  | 'none'
  | 'pending'
  | 'verified'
  | 'attaching'
  | 'attached'
  | 'active'
  | 'failed';

export interface DomainRow {
  custom_domain: string | null;
  domain_verified_at: string | null;
  domain_vercel_state?: string | null;
  domain_active_at?: string | null;
}

/** The one state function the console, admin list and probes share. */
export function domainState(row: DomainRow | null | undefined): DomainState {
  if (!row?.custom_domain) return 'none';
  if (row.domain_active_at) return 'active';
  if (row.domain_vercel_state === 'failed') return 'failed';
  if (row.domain_vercel_state === 'attached') return 'attached';
  if (row.domain_verified_at) return row.domain_vercel_state === 'pending' ? 'attaching' : 'verified';
  return 'pending';
}

export interface DnsInstruction {
  type: 'TXT' | 'CNAME' | 'A';
  name: string;
  value: string;
  purpose: string;
}

/** What the manager pastes into their DNS: ownership TXT + the Vercel
 *  CNAME (apex domains get Vercel's A record instead). */
export function dnsInstructions(host: string, token: string): DnsInstruction[] {
  const labels = host.split('.');
  const isApex = labels.length === 2;
  return [
    {
      type: 'TXT',
      name: verificationRecordName(host),
      value: token,
      purpose: 'Proves you control the domain',
    },
    isApex
      ? { type: 'A', name: host, value: '76.76.21.21', purpose: 'Points the domain at Edge Athlete' }
      : {
          type: 'CNAME',
          name: host,
          value: VERCEL_CNAME_TARGET,
          purpose: 'Points the domain at Edge Athlete',
        },
  ];
}

/** TXT answers arrive as arrays of chunks; a match is any record whose
 *  joined chunks equal the token exactly. */
export function txtRecordsCarryToken(records: string[][], token: string): boolean {
  return records.some(chunks => chunks.join('').trim() === token);
}
