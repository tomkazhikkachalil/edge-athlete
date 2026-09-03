// ── The season wrap — the I/O half (phase 8 P6) ─────────────────────────────
// The console's "Announce the season result": the summary comes from the
// public standings payload (buildSeasonSummary — the same masking and
// omission the site shows), the copy from seasonAnnouncement, the bells
// and the site notice from the announce rails (orgAnnouncePOST, the
// org-announce bucket). Announced ONCE per competition: the rows carry
// `season_competition_id`, so a repeat answers 409 with the date.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { orgAnnouncePOST } from '@/lib/orgs/announce-server';
import { fetchPublicStandings } from './public-standings';
import { seasonAnnouncement, type SeasonSummary } from './golf-season-wrap';
import { addDaysIso, utcToday } from './golf-weeks';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const NOTICE_DAYS = 14;

async function announcedAt(admin: Admin, competitionId: string): Promise<string | null> {
  const { data } = await admin
    .from('notifications')
    .select('created_at')
    .contains('metadata', { season_competition_id: competitionId })
    .order('created_at', { ascending: true })
    .limit(1);
  return (data?.[0]?.created_at as string | undefined) ?? null;
}

async function summaryFor(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  competitionId: string
): Promise<{ name: string; summary: SeasonSummary } | null> {
  const standings = await fetchPublicStandings(admin, side, orgId);
  const comp = standings?.competitions.find(c => c.id === competitionId);
  return comp?.seasonSummary ? { name: comp.name, summary: comp.seasonSummary } : null;
}

/** GET — the state the console button needs. */
export async function seasonAnnounceGET(admin: Admin, side: OrgSide, orgId: string, competitionId: string): Promise<NextResponse> {
  const [found, at] = await Promise.all([summaryFor(admin, side, orgId, competitionId), announcedAt(admin, competitionId)]);
  return NextResponse.json({ summary: found?.summary ?? null, announcedAt: at });
}

/** POST — announce once. */
export async function seasonAnnouncePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  competitionId: string,
  actorId: string
): Promise<NextResponse> {
  const at = await announcedAt(admin, competitionId);
  if (at) return NextResponse.json({ error: 'The season result was already announced', announcedAt: at }, { status: 409 });
  const found = await summaryFor(admin, side, orgId, competitionId);
  if (!found) return NextResponse.json({ error: 'The season is not complete yet' }, { status: 400 });
  const copy = seasonAnnouncement(found.name, found.summary);
  return orgAnnouncePOST(
    admin,
    side,
    orgId,
    { ...copy, siteNoticeUntil: addDaysIso(utcToday(), NOTICE_DAYS) },
    actorId,
    { extraMetadata: { season_competition_id: competitionId } }
  );
}
