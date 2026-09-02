/**
 * Custom domains — the SERVER half (phase 6b C1): claim, verify (DNS TXT),
 * attach (Vercel REST), check (the reachability proof), detach. The pure
 * rules live in domains.ts; the route twins are thin gates.
 *
 * Runs on the Node runtime (route handlers) — `node:dns` and outbound
 * fetches are fine here and never in the Edge middleware.
 *
 * Environment (ALL Tom's ops; server-only, a redeploy suffices):
 *   VERCEL_API_TOKEN, VERCEL_TEAM_ID, VERCEL_PROJECT_ID — the attach/detach
 *   calls. Unset → a verified domain stays `verified` with
 *   `{ awaitingPlatform: true }` in domain_vercel_detail: shippable before
 *   the ops step, visible in the admin list, retried from there.
 *
 * Pre-171 databases degrade: reads answer state 'none' with
 * migrationPending:true, writes answer a friendly 409.
 */

import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { revalidateTag } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import {
  WELL_KNOWN_PATH,
  dnsInstructions,
  domainState,
  isReservedDomain,
  isValidCustomDomain,
  normalizeHostname,
  txtRecordsCarryToken,
  verificationRecordName,
  type DnsInstruction,
  type DomainState,
} from './domains';
import { appBaseUrl } from './urls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG DOMAINS]';
const DOMAIN_FIELDS =
  'id, subdomain, published_at, custom_domain, domain_verified_at, domain_verification_token, domain_requested_at, domain_vercel_state, domain_vercel_at, domain_vercel_detail, domain_active_at';

interface DomainSiteRow {
  id: string;
  subdomain: string;
  published_at: string | null;
  custom_domain: string | null;
  domain_verified_at: string | null;
  domain_verification_token: string | null;
  domain_requested_at: string | null;
  domain_vercel_state: string | null;
  domain_vercel_at: string | null;
  domain_vercel_detail: Record<string, unknown> | null;
  domain_active_at: string | null;
}

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

function isPre171(error: { code?: string } | null | undefined): boolean {
  return error?.code === '42703' || error?.code === 'PGRST204';
}

const PRE_171 = () =>
  NextResponse.json({ error: 'Custom domains need a database migration first (171)' }, { status: 409 });

async function loadSite(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ site: DomainSiteRow | null; pre171: boolean }> {
  const { data, error } = await admin
    .from('org_sites')
    .select(DOMAIN_FIELDS)
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  if (error) {
    if (isPre171(error)) return { site: null, pre171: true };
    console.error(`${TAG} site read error:`, error);
    return { site: null, pre171: false };
  }
  return { site: (data as unknown as DomainSiteRow) ?? null, pre171: false };
}

export interface DomainStatus {
  state: DomainState;
  domain: string | null;
  instructions: DnsInstruction[];
  /** Vercel's own verification rows when it asked for one (rare: the
   *  domain is claimed by another Vercel account). */
  platformVerification: { type: string; domain: string; value: string }[];
  verifiedAt: string | null;
  attachedAt: string | null;
  activeAt: string | null;
  failure: string | null;
  awaitingPlatform: boolean;
  migrationPending?: boolean;
}

function toStatus(site: DomainSiteRow | null, migrationPending = false): DomainStatus {
  const state = domainState(site);
  const detail = (site?.domain_vercel_detail ?? {}) as Record<string, unknown>;
  const verification = Array.isArray(detail.verification)
    ? (detail.verification as { type?: string; domain?: string; value?: string }[])
        .filter(v => v && typeof v.value === 'string')
        .map(v => ({ type: String(v.type ?? 'TXT'), domain: String(v.domain ?? ''), value: String(v.value) }))
    : [];
  return {
    state,
    domain: site?.custom_domain ?? null,
    instructions:
      site?.custom_domain && site.domain_verification_token
        ? dnsInstructions(site.custom_domain, site.domain_verification_token)
        : [],
    platformVerification: verification,
    verifiedAt: site?.domain_verified_at ?? null,
    attachedAt: site?.domain_vercel_state === 'attached' ? (site.domain_vercel_at ?? null) : null,
    activeAt: site?.domain_active_at ?? null,
    failure: typeof detail.error === 'string' ? detail.error : null,
    awaitingPlatform: state === 'verified' && detail.awaitingPlatform === true,
    ...(migrationPending ? { migrationPending: true } : {}),
  };
}

function appHost(): string {
  return new URL(appBaseUrl()).host;
}

// ── Vercel REST ─────────────────────────────────────────────────────────────

function vercelEnv(): { token: string; projectId: string; teamId: string | null } | null {
  const token = process.env.VERCEL_API_TOKEN;
  const projectId = process.env.VERCEL_PROJECT_ID;
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID || null };
}

function vercelUrl(path: string, teamId: string | null): string {
  return `https://api.vercel.com${path}${teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''}`;
}

/** Attach the domain to the project. Returns the state to store. */
async function attachDomainToVercel(
  domain: string
): Promise<{ state: 'attached' | 'failed'; detail: Record<string, unknown> } | { state: null }> {
  const env = vercelEnv();
  if (!env) return { state: null };
  try {
    const res = await fetch(vercelUrl(`/v10/projects/${env.projectId}/domains`, env.teamId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: domain }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    // 409 = already added to this project — as good as attached.
    if (res.ok || res.status === 409) {
      return {
        state: 'attached',
        detail: {
          verification: Array.isArray(body.verification) ? body.verification : [],
          verified: body.verified === true,
        },
      };
    }
    console.error(`${TAG} vercel attach ${res.status}:`, body);
    const err = body.error as { message?: string; code?: string } | undefined;
    return { state: 'failed', detail: { error: err?.message ?? `Vercel refused the domain (${res.status})`, code: err?.code ?? null } };
  } catch (error) {
    console.error(`${TAG} vercel attach error:`, error);
    return { state: 'failed', detail: { error: 'Could not reach Vercel — try again' } };
  }
}

async function detachDomainFromVercel(domain: string): Promise<void> {
  const env = vercelEnv();
  if (!env) return;
  try {
    await fetch(vercelUrl(`/v9/projects/${env.projectId}/domains/${encodeURIComponent(domain)}`, env.teamId), {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error(`${TAG} vercel detach error (best-effort):`, error);
  }
}

// ── The reachability proof ──────────────────────────────────────────────────

/** True when https://<domain>/.well-known/edge-athlete answers this slug —
 *  i.e. DNS points here AND the middleware serves the site (C2). */
export async function probeDomainServesSlug(domain: string, slug: string): Promise<boolean> {
  try {
    const res = await fetch(`https://${domain}${WELL_KNOWN_PATH}`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(6_000),
      headers: { 'user-agent': 'EdgeAthlete-DomainCheck/1.0' },
    });
    if (!res.ok) return false;
    return (await res.text()).trim() === slug;
  } catch {
    return false;
  }
}

async function purge(site: { subdomain: string }): Promise<void> {
  revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
  revalidateTag('org-sitemap', { expire: 0 });
}

// ── Route cores ─────────────────────────────────────────────────────────────

export async function domainGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { site, pre171 } = await loadSite(admin, side, orgId);
  if (pre171) return NextResponse.json({ domain: toStatus(null, true) });
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  return NextResponse.json({ domain: toStatus(site) });
}

/** Claim a domain: validate, reserve-check, mint the token. Replacing an
 *  existing claim resets every downstream state (and detaches the old
 *  domain from Vercel, best-effort). */
export async function domainPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: { domain: string }
): Promise<NextResponse> {
  const domain = normalizeHostname(input.domain);
  if (!isValidCustomDomain(domain)) {
    return NextResponse.json({ error: 'Enter a domain like kmha.ca or hockey.kmha.ca' }, { status: 400 });
  }
  if (isReservedDomain(domain, appHost())) {
    return NextResponse.json({ error: 'That domain is reserved' }, { status: 400 });
  }
  const { site, pre171 } = await loadSite(admin, side, orgId);
  if (pre171) return PRE_171();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (!site.published_at) {
    return NextResponse.json({ error: 'Publish the site before adding a domain' }, { status: 409 });
  }
  if (site.custom_domain === domain) return NextResponse.json({ domain: toStatus(site) });
  if (site.custom_domain) await detachDomainFromVercel(site.custom_domain);

  const token = randomBytes(32).toString('hex');
  const { data, error } = await admin
    .from('org_sites')
    .update({
      custom_domain: domain,
      domain_verification_token: token,
      domain_requested_at: new Date().toISOString(),
      domain_verified_at: null,
      domain_vercel_state: null,
      domain_vercel_at: null,
      domain_vercel_detail: null,
      domain_active_at: null,
    })
    .eq('id', site.id)
    .select(DOMAIN_FIELDS)
    .maybeSingle();
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That domain is already in use by another site' }, { status: 409 });
    }
    if (error.code === '23514') {
      return NextResponse.json({ error: 'Enter a domain like kmha.ca or hockey.kmha.ca' }, { status: 400 });
    }
    if (isPre171(error)) return PRE_171();
    console.error(`${TAG} claim error:`, error);
    return NextResponse.json({ error: 'Failed to save the domain' }, { status: 500 });
  }
  await purge(site);
  return NextResponse.json({ domain: toStatus(data as unknown as DomainSiteRow) });
}

/** Verify ownership: resolve the TXT record; on a match record it and
 *  attach the domain to Vercel (or mark it awaiting the platform step). */
export async function domainVerifyPOST(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { site, pre171 } = await loadSite(admin, side, orgId);
  if (pre171) return PRE_171();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (!site.custom_domain || !site.domain_verification_token) {
    return NextResponse.json({ error: 'No domain to verify' }, { status: 409 });
  }

  if (!site.domain_verified_at) {
    let records: string[][] = [];
    try {
      records = await Promise.race([
        dns.resolveTxt(verificationRecordName(site.custom_domain)),
        new Promise<string[][]>((_, reject) => setTimeout(() => reject(new Error('timeout')), 6_000)),
      ]);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA' || (error as Error).message === 'timeout') {
        return NextResponse.json(
          { error: 'The TXT record isn’t visible yet — DNS changes can take a few minutes', domain: toStatus(site) },
          { status: 409 }
        );
      }
      console.error(`${TAG} dns error:`, error);
      return NextResponse.json({ error: 'Could not look up the domain right now' }, { status: 502 });
    }
    if (!txtRecordsCarryToken(records, site.domain_verification_token)) {
      return NextResponse.json(
        { error: 'The TXT record was found but doesn’t carry your token', domain: toStatus(site) },
        { status: 409 }
      );
    }
    const { error } = await admin
      .from('org_sites')
      .update({ domain_verified_at: new Date().toISOString() })
      .eq('id', site.id);
    if (error) {
      console.error(`${TAG} verify write error:`, error);
      return NextResponse.json({ error: 'Failed to record the verification' }, { status: 500 });
    }
    site.domain_verified_at = new Date().toISOString();
  }

  return await attachAndRespond(admin, site);
}

async function attachAndRespond(admin: Admin, site: DomainSiteRow): Promise<NextResponse> {
  const result = await attachDomainToVercel(site.custom_domain as string);
  const patch =
    result.state === null
      ? { domain_vercel_state: null, domain_vercel_at: null, domain_vercel_detail: { awaitingPlatform: true } }
      : { domain_vercel_state: result.state, domain_vercel_at: new Date().toISOString(), domain_vercel_detail: result.detail };
  const { data, error } = await admin
    .from('org_sites')
    .update(patch)
    .eq('id', site.id)
    .select(DOMAIN_FIELDS)
    .maybeSingle();
  if (error) {
    console.error(`${TAG} attach write error:`, error);
    return NextResponse.json({ error: 'Failed to record the platform step' }, { status: 500 });
  }
  await purge(site);
  return NextResponse.json({ domain: toStatus(data as unknown as DomainSiteRow) });
}

/** "Check connection": re-attach if needed, then the reachability proof.
 *  Activation is the ONLY path that sets domain_active_at. */
export async function domainCheckPOST(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { site, pre171 } = await loadSite(admin, side, orgId);
  if (pre171) return PRE_171();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (!site.custom_domain || !site.domain_verified_at) {
    return NextResponse.json({ error: 'Verify the domain first' }, { status: 409 });
  }
  if (site.domain_vercel_state !== 'attached') {
    const res = await attachAndRespond(admin, site);
    if (res.status !== 200) return res;
    const { site: fresh } = await loadSite(admin, side, orgId);
    if (!fresh || fresh.domain_vercel_state !== 'attached') return res;
  }
  const serves = await probeDomainServesSlug(site.custom_domain, site.subdomain);
  if (!serves) {
    return NextResponse.json(
      {
        error: 'The domain doesn’t reach this site yet — check the CNAME/A record and try again in a few minutes',
        domain: toStatus((await loadSite(admin, side, orgId)).site),
      },
      { status: 409 }
    );
  }
  const { data, error } = await admin
    .from('org_sites')
    .update({ domain_active_at: site.domain_active_at ?? new Date().toISOString() })
    .eq('id', site.id)
    .select(DOMAIN_FIELDS)
    .maybeSingle();
  if (error) {
    console.error(`${TAG} activate write error:`, error);
    return NextResponse.json({ error: 'Failed to activate the domain' }, { status: 500 });
  }
  await purge(site);
  return NextResponse.json({ domain: toStatus(data as unknown as DomainSiteRow) });
}

/** Remove the domain entirely (Vercel detach best-effort). */
export async function domainDELETE(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { site, pre171 } = await loadSite(admin, side, orgId);
  if (pre171) return PRE_171();
  if (!site) return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  if (site.custom_domain) await detachDomainFromVercel(site.custom_domain);
  const { error } = await admin
    .from('org_sites')
    .update({
      custom_domain: null,
      domain_verification_token: null,
      domain_requested_at: null,
      domain_verified_at: null,
      domain_vercel_state: null,
      domain_vercel_at: null,
      domain_vercel_detail: null,
      domain_active_at: null,
    })
    .eq('id', site.id);
  if (error) {
    console.error(`${TAG} detach error:`, error);
    return NextResponse.json({ error: 'Failed to remove the domain' }, { status: 500 });
  }
  await purge(site);
  return NextResponse.json({ domain: toStatus({ ...site, custom_domain: null, domain_verified_at: null, domain_active_at: null, domain_vercel_state: null }) });
}

// ── Admin list + actions ────────────────────────────────────────────────────

export interface AdminDomainRow {
  siteId: string;
  slug: string;
  orgName: string;
  side: OrgSide;
  domain: string;
  state: DomainState;
  requestedAt: string | null;
  verifiedAt: string | null;
  activeAt: string | null;
  failure: string | null;
  awaitingPlatform: boolean;
  platformConfigured: boolean;
}

export async function adminDomainsGET(admin: Admin): Promise<NextResponse> {
  const { data: sites, error } = await admin
    .from('org_sites')
    .select(`${DOMAIN_FIELDS}, league_id, club_id`)
    .not('custom_domain', 'is', null)
    .order('domain_requested_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isPre171(error) || error.code === '42P01') return NextResponse.json({ domains: [], platformConfigured: !!vercelEnv() });
    console.error(`${TAG} admin list error:`, error);
    return NextResponse.json({ error: 'Failed to list domains' }, { status: 500 });
  }
  const rows = (sites ?? []) as unknown as (DomainSiteRow & { league_id: string | null; club_id: string | null })[];
  const leagueIds = rows.map(r => r.league_id).filter((v): v is string => !!v);
  const clubIds = rows.map(r => r.club_id).filter((v): v is string => !!v);
  const [leagues, clubs] = await Promise.all([
    leagueIds.length ? admin.from('leagues').select('id, name').in('id', leagueIds) : Promise.resolve({ data: [] }),
    clubIds.length ? admin.from('clubs').select('id, name').in('id', clubIds) : Promise.resolve({ data: [] }),
  ]);
  const names = new Map([...(leagues.data ?? []), ...(clubs.data ?? [])].map(o => [o.id as string, o.name as string]));
  const platformConfigured = !!vercelEnv();
  const domains: AdminDomainRow[] = rows.map(r => {
    const status = toStatus(r);
    const side: OrgSide = r.league_id ? 'league' : 'club';
    return {
      siteId: r.id,
      slug: r.subdomain,
      orgName: names.get((r.league_id ?? r.club_id) as string) ?? '?',
      side,
      domain: r.custom_domain as string,
      state: status.state,
      requestedAt: r.domain_requested_at,
      verifiedAt: r.domain_verified_at,
      activeAt: r.domain_active_at,
      failure: status.failure,
      awaitingPlatform: status.awaitingPlatform,
      platformConfigured,
    };
  });
  return NextResponse.json({ domains, platformConfigured });
}

/** Admin retry: re-run the attach (after the ops env lands) or the probe. */
export async function adminDomainActionPOST(
  admin: Admin,
  input: { siteId: string; action: 'retry-attach' | 'probe' }
): Promise<NextResponse> {
  const { data, error } = await admin
    .from('org_sites')
    .select(`${DOMAIN_FIELDS}, league_id, club_id`)
    .eq('id', input.siteId)
    .maybeSingle();
  if (error || !data) {
    if (isPre171(error)) return PRE_171();
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  const row = data as unknown as DomainSiteRow & { league_id: string | null; club_id: string | null };
  const side: OrgSide = row.league_id ? 'league' : 'club';
  const orgId = (row.league_id ?? row.club_id) as string;
  if (input.action === 'retry-attach') {
    if (!row.domain_verified_at) return NextResponse.json({ error: 'Not verified yet' }, { status: 409 });
    return await attachAndRespond(admin, row);
  }
  return await domainCheckPOST(admin, side, orgId);
}
