// ── The public-gallery gate (phase 4 R5) ────────────────────────────────────
// What may render on a PUBLIC org site from the contest media library.
// The bar (Tom's call, Sep 1): the org explicitly PUBLISHED the item
// (158's curation bit) AND every actively tagged athlete is cleared by a
// photo_consent=true org-scope roster row (159) with an org that touches
// the contest — the owning org or the org owning a participating team
// (consent follows the membership through which the athlete
// participates: a club kid's parent consents to the CLUB, and that
// clears league-site galleries their team plays in). Untagged published
// items rely on the org's explicit publish act. Everything here fails
// CLOSED: missing rows, missing columns (pre-159), private/inactive
// competitions and unpublished items are all ineligible.
//
// Shared by the batch reader (fetchPublicGallery) and the per-request
// public streamer (/api/media/contest-media/[mediaId]) — one rule, two
// call shapes, so a stale ISR document can never out-serve the gate.

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

export function orgKey(side: 'league' | 'club', id: string): string {
  return `${side}:${id}`;
}

/** Pure: is this tagged profile cleared for a contest touched by
 *  `contestOrgKeys`? `consentPairs` holds "profileId|side:orgId" entries
 *  minted only from photo_consent=true rows. */
export function isProfileCleared(
  profileId: string,
  contestOrgKeys: string[],
  consentPairs: ReadonlySet<string>
): boolean {
  return contestOrgKeys.some(key => consentPairs.has(`${profileId}|${key}`));
}

export interface PublicGalleryMedia {
  id: string;
  storagePath: string;
  mediaType: 'image' | 'video';
  caption: string | null;
  createdAt: string;
  contestId: string;
  contestDate: string | null;
  competitionName: string;
  taggedProfileIds: string[];
}

/** Batch-evaluate contest media for public rendering. Returns ONLY the
 *  eligible items, newest first. Never throws; any failure reads as
 *  nothing-eligible. */
export async function evaluatePublicContestMedia(
  admin: Admin,
  mediaIds: string[]
): Promise<PublicGalleryMedia[]> {
  if (mediaIds.length === 0) return [];
  try {
    const { data: mediaRows, error } = await admin
      .from('contest_media')
      .select('id, contest_id, storage_path, media_type, caption, published, created_at')
      .in('id', mediaIds)
      .eq('published', true);
    if (error || !mediaRows || mediaRows.length === 0) return [];

    const contestIds = [...new Set(mediaRows.map(m => m.contest_id as string))];
    const { data: contests } = await admin
      .from('contests')
      .select('id, scheduled_at, competition_id')
      .in('id', contestIds);
    const contestById = new Map(
      (contests ?? []).map(c => [
        c.id as string,
        { scheduledAt: (c.scheduled_at as string | null) ?? null, competitionId: c.competition_id as string },
      ])
    );
    const compIds = [...new Set([...contestById.values()].map(c => c.competitionId))];
    const { data: comps } = compIds.length
      ? await admin
          .from('competitions')
          .select('id, name, visibility, status, league_id, club_id')
          .in('id', compIds)
          .eq('visibility', 'public')
          .in('status', ['active', 'completed'])
      : { data: [] };
    const compById = new Map(
      (comps ?? []).map(c => [
        c.id as string,
        {
          name: c.name as string,
          leagueId: (c.league_id as string | null) ?? null,
          clubId: (c.club_id as string | null) ?? null,
        },
      ])
    );

    // Active tags per media.
    const { data: tagRows } = await admin
      .from('contest_media_tags')
      .select('media_id, profile_id')
      .in('media_id', mediaRows.map(m => m.id as string))
      .eq('status', 'active')
      .limit(1000);
    const tagsByMedia = new Map<string, string[]>();
    const taggedProfiles = new Set<string>();
    for (const t of tagRows ?? []) {
      const mid = t.media_id as string;
      if (!tagsByMedia.has(mid)) tagsByMedia.set(mid, []);
      tagsByMedia.get(mid)!.push(t.profile_id as string);
      taggedProfiles.add(t.profile_id as string);
    }

    // The orgs touching each contest: the owning org + the owning org of
    // every participating team.
    const { data: participants } = await admin
      .from('contest_participants')
      .select('contest_id, entry:entry_id (team_id)')
      .in('contest_id', contestIds)
      .limit(1000);
    const teamIdsByContest = new Map<string, string[]>();
    const allTeamIds = new Set<string>();
    for (const p of participants ?? []) {
      const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
      const teamId = entry?.team_id as string | null;
      if (!teamId) continue;
      const cid = p.contest_id as string;
      if (!teamIdsByContest.has(cid)) teamIdsByContest.set(cid, []);
      teamIdsByContest.get(cid)!.push(teamId);
      allTeamIds.add(teamId);
    }
    const { data: teamRows } = allTeamIds.size
      ? await admin.from('teams').select('id, league_id, club_id').in('id', [...allTeamIds])
      : { data: [] };
    const teamOrg = new Map(
      (teamRows ?? []).map(t => [
        t.id as string,
        t.league_id
          ? orgKey('league', t.league_id as string)
          : t.club_id
            ? orgKey('club', t.club_id as string)
            : null,
      ])
    );
    const orgKeysForContest = (contestId: string, comp: { leagueId: string | null; clubId: string | null }) => {
      const keys = new Set<string>();
      if (comp.leagueId) keys.add(orgKey('league', comp.leagueId));
      if (comp.clubId) keys.add(orgKey('club', comp.clubId));
      for (const teamId of teamIdsByContest.get(contestId) ?? []) {
        const key = teamOrg.get(teamId);
        if (key) keys.add(key);
      }
      return [...keys];
    };

    // Consent pairs: photo_consent=true org-scope roster rows for the
    // tagged profiles across every org in play. Pre-159 (42703) reads as
    // no pairs — nothing tagged renders.
    const leagueIds = new Set<string>();
    const clubIds = new Set<string>();
    for (const comp of compById.values()) {
      if (comp.leagueId) leagueIds.add(comp.leagueId);
      if (comp.clubId) clubIds.add(comp.clubId);
    }
    for (const key of teamOrg.values()) {
      if (!key) continue;
      const [side, id] = key.split(':');
      (side === 'league' ? leagueIds : clubIds).add(id);
    }
    const consentPairs = new Set<string>();
    if (taggedProfiles.size > 0) {
      const profileList = [...taggedProfiles];
      const [leagueRes, clubRes] = await Promise.all([
        leagueIds.size
          ? admin
              .from('memberships')
              .select('profile_id, league_id')
              .in('profile_id', profileList)
              .in('league_id', [...leagueIds])
              .eq('kind', 'roster')
              .eq('scope_type', 'org')
              .eq('status', 'active')
              .eq('photo_consent', true)
          : Promise.resolve({ data: [], error: null }),
        clubIds.size
          ? admin
              .from('memberships')
              .select('profile_id, club_id')
              .in('profile_id', profileList)
              .in('club_id', [...clubIds])
              .eq('kind', 'roster')
              .eq('scope_type', 'org')
              .eq('status', 'active')
              .eq('photo_consent', true)
          : Promise.resolve({ data: [], error: null }),
      ]);
      for (const r of leagueRes.error ? [] : (leagueRes.data ?? [])) {
        consentPairs.add(`${r.profile_id}|${orgKey('league', r.league_id as string)}`);
      }
      for (const r of clubRes.error ? [] : (clubRes.data ?? [])) {
        consentPairs.add(`${r.profile_id}|${orgKey('club', r.club_id as string)}`);
      }
    }

    const out: PublicGalleryMedia[] = [];
    for (const m of mediaRows) {
      const contest = contestById.get(m.contest_id as string);
      if (!contest) continue;
      const comp = compById.get(contest.competitionId);
      if (!comp) continue; // private / inactive competition
      const tags = tagsByMedia.get(m.id as string) ?? [];
      const contestOrgs = orgKeysForContest(m.contest_id as string, comp);
      if (!tags.every(profileId => isProfileCleared(profileId, contestOrgs, consentPairs))) {
        continue;
      }
      out.push({
        id: m.id as string,
        storagePath: m.storage_path as string,
        mediaType: m.media_type as 'image' | 'video',
        caption: (m.caption as string | null) ?? null,
        createdAt: m.created_at as string,
        contestId: m.contest_id as string,
        contestDate: contest.scheduledAt,
        competitionName: comp.name,
        taggedProfileIds: tags,
      });
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  } catch {
    return [];
  }
}
