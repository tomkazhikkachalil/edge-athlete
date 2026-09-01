// ── Contest media — the shared core (phase 4, R3, mig 158) ──────────────────
// The masterplan's "media uploaded in a contest context inherits
// competition, contest, teams and date automatically": an ORG-SIDE
// library (coach photos are org artifacts — §8 invariant 1), private in
// the uploads bucket, served only through the signed media proxy
// ('contest_media' entity). Authority rides the R1 rule
// (resolveCompetitionAccess): the owner manages everything; a
// participating club's staff uploads and tags for its OWN teams only.
//
// TAG RULES (the attribution gate + the tombstone lesson):
//  * Taggable set = ACTIVE ROSTER members of the contest's participating
//    teams (narrowed to the club's teams for participants) — the same
//    thirty-item picker as stat lines, never a search.
//  * Tag insert is ON CONFLICT DO NOTHING: a 'removed' row is a TOMBSTONE
//    (an athlete or guardian who untagged is never silently re-added —
//    the mirror-tags lesson). Untag flips status, never deletes.
//  * Tagging a supervised profile bells the guardians (tag_alert) and
//    the athlete; tags land immediately (Tom's call — matches post tags).
//  * `published` is the org's explicit gallery-curation bit (R5 reads it
//    together with photo consent); only the OWNER may flip it.
//
// Pre-158 databases degrade: reads answer empty with
// mediaAvailable:false, uploads answer a friendly error.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/competitions/validate';
import { signMediaToken } from '@/lib/media/token';
import { notifyGuardians, notifyUser, profileFirstName } from '@/lib/guardian-notify';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';
import type { CompetitionScope } from './competition-server';
import {
  resolveCompetitionAccess,
  rosterByTeam,
  type CompetitionAccess,
  type CompRow,
} from './stat-lines-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[CONTEST MEDIA]';
const MEDIA_PER_CONTEST_MAX = 100;
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const EXT_BY_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
};
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** Proxy path for a contest-media object — the ONLY way its bytes are
 *  served (the object has no public URL; on a signing failure we return
 *  null and the tile renders a placeholder, never a raw URL). */
export function contestMediaProxyPath(storagePath: string, mediaId: string): string | null {
  try {
    return `/api/media/${signMediaToken({ b: 'uploads', k: storagePath, t: 'contest_media', id: mediaId })}`;
  } catch {
    return null;
  }
}

async function loadContestWithComp(
  admin: Admin,
  contestId: string
): Promise<{ contest: { id: string; status: string }; comp: CompRow } | null> {
  const { data: row } = await admin
    .from('contests')
    .select(
      'id, status, competition:competition_id (id, name, sport_key, format, status, league_id, club_id)'
    )
    .eq('id', contestId)
    .maybeSingle();
  const compRaw = row?.competition;
  const comp = (Array.isArray(compRaw) ? compRaw[0] : compRaw) as CompRow | null | undefined;
  if (!row || !comp) return null;
  return { contest: { id: row.id as string, status: row.status as string }, comp };
}

/** The contest's participating team ids, narrowed by authority. */
async function allowedContestTeams(
  admin: Admin,
  contestId: string,
  access: CompetitionAccess
): Promise<Set<string>> {
  const { data: participants } = await admin
    .from('contest_participants')
    .select('entry:entry_id (team_id)')
    .eq('contest_id', contestId);
  const teamIds = new Set<string>();
  for (const p of participants ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    if (entry?.team_id) teamIds.add(entry.team_id as string);
  }
  if (access.authority === 'owner') return teamIds;
  return new Set([...teamIds].filter(id => access.clubTeamIds.has(id)));
}

/** Media rows for ONE contest + the taggable roster — the media panel's
 *  whole data source. */
export async function contestMediaGET(
  admin: Admin,
  contestId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const loaded = await loadContestWithComp(admin, contestId);
  if (!loaded) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access) return NextResponse.json({ error: 'Game not found' }, { status: 404 });

  const { data: mediaRows, error } = await admin
    .from('contest_media')
    .select('id, storage_path, media_type, caption, published, uploaded_by, created_at')
    .eq('contest_id', contestId)
    .order('created_at', { ascending: false })
    .limit(MEDIA_PER_CONTEST_MAX + 5);
  if (error) {
    if (isMissingTableError(error.code)) {
      return NextResponse.json({ media: [], rosterByTeam: {}, mediaAvailable: false });
    }
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load media' }, { status: 500 });
  }

  const mediaIds = (mediaRows ?? []).map(m => m.id as string);
  const { data: tagRows } = mediaIds.length
    ? await admin
        .from('contest_media_tags')
        .select('media_id, profile_id, status')
        .in('media_id', mediaIds)
        .eq('status', 'active')
    : { data: [] };
  const tagsByMedia = new Map<string, string[]>();
  const taggedProfileIds = new Set<string>();
  for (const t of tagRows ?? []) {
    const mid = t.media_id as string;
    if (!tagsByMedia.has(mid)) tagsByMedia.set(mid, []);
    tagsByMedia.get(mid)!.push(t.profile_id as string);
    taggedProfileIds.add(t.profile_id as string);
  }

  const teams = await allowedContestTeams(admin, contestId, access);
  const roster = await rosterByTeam(admin, [...teams]);
  const rosterIds = [...new Set([...roster.values()].flatMap(s => [...s]))];
  const nameIds = [...new Set([...rosterIds, ...taggedProfileIds])];
  const { data: profileRows } = nameIds.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name').in('id', nameIds)
    : { data: [] };
  const names = new Map(
    (profileRows ?? []).map(p => [
      p.id as string,
      ((p.full_name as string | null) ||
        `${(p.first_name as string | null) ?? ''} ${(p.last_name as string | null) ?? ''}`.trim()) ||
        'Athlete',
    ])
  );
  const { data: teamRows } = teams.size
    ? await admin.from('teams').select('id, name, display_name').in('id', [...teams])
    : { data: [] };
  const teamNames = new Map(
    (teamRows ?? []).map(t => [
      t.id as string,
      ((t.display_name as string | null) || (t.name as string)) ?? 'Team',
    ])
  );

  return NextResponse.json({
    mediaAvailable: true,
    access: access.authority,
    media: (mediaRows ?? []).map(m => ({
      id: m.id,
      mediaType: m.media_type,
      caption: m.caption,
      published: m.published,
      uploadedBy: m.uploaded_by,
      createdAt: m.created_at,
      url: contestMediaProxyPath(m.storage_path as string, m.id as string),
      tags: (tagsByMedia.get(m.id as string) ?? []).map(profileId => ({
        profileId,
        displayName: names.get(profileId) ?? 'Athlete',
      })),
    })),
    rosterByTeam: Object.fromEntries(
      [...teams].map(teamId => [
        teamId,
        {
          teamName: teamNames.get(teamId) ?? 'Team',
          athletes: [...(roster.get(teamId) ?? [])]
            .map(profileId => ({ profileId, displayName: names.get(profileId) ?? 'Athlete' }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        },
      ])
    ),
  });
}

/** Upload one file into the contest's library. The storage key is fully
 *  server-derived (nothing caller-controlled — the post-media recipe). */
export async function contestMediaUploadPOST(
  admin: Admin,
  contestId: string,
  file: File,
  caption: string | null,
  scope: CompetitionScope | null,
  uploadedBy: string
): Promise<NextResponse> {
  const loaded = await loadContestWithComp(admin, contestId);
  if (!loaded) return NextResponse.json({ error: 'Game not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access) return NextResponse.json({ error: 'Game not found' }, { status: 404 });

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: 'File size must be less than 50MB' }, { status: 400 });
  }
  const ext = EXT_BY_TYPE[file.type];
  if (!ext) {
    return NextResponse.json(
      { error: 'Please select a valid image or video (JPG, PNG, WebP, MP4, MOV, WebM)' },
      { status: 400 }
    );
  }
  if (caption && caption.length > 300) {
    return NextResponse.json({ error: 'Captions max out at 300 characters' }, { status: 400 });
  }

  const { count, error: countError } = await admin
    .from('contest_media')
    .select('id', { count: 'exact', head: true })
    .eq('contest_id', contestId);
  if (countError && isMissingTableError(countError.code)) {
    return NextResponse.json(
      { error: 'Contest media isn’t set up yet — ask your admin (migration 158)' },
      { status: 400 }
    );
  }
  if ((count ?? 0) >= MEDIA_PER_CONTEST_MAX) {
    return NextResponse.json(
      { error: `A game can hold at most ${MEDIA_PER_CONTEST_MAX} media items` },
      { status: 400 }
    );
  }

  const storagePath = `contest-media/${contestId}/${crypto.randomUUID()}.${ext}`;
  const { error: uploadError } = await admin.storage.from('uploads').upload(storagePath, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  });
  if (uploadError) {
    console.error(`${TAG} storage upload error:`, uploadError);
    return NextResponse.json({ error: 'Failed to upload the file' }, { status: 500 });
  }

  const { data: row, error } = await admin
    .from('contest_media')
    .insert({
      contest_id: contestId,
      storage_path: storagePath,
      media_type: IMAGE_TYPES.has(file.type) ? 'image' : 'video',
      caption: caption || null,
      uploaded_by: uploadedBy,
    })
    .select('id, media_type, caption, published, created_at')
    .single();
  if (error || !row) {
    // Don't strand the object when the row can't be written.
    await admin.storage.from('uploads').remove([storagePath]);
    if (error && isMissingTableError(error.code)) {
      return NextResponse.json(
        { error: 'Contest media isn’t set up yet — ask your admin (migration 158)' },
        { status: 400 }
      );
    }
    console.error(`${TAG} insert error:`, error);
    return NextResponse.json({ error: 'Failed to save the media' }, { status: 500 });
  }
  return NextResponse.json({
    media: { ...row, url: contestMediaProxyPath(storagePath, row.id as string), tags: [] },
  });
}

/** Delete one media item (bytes + row + tags via CASCADE). Owner
 *  authority, or the participant who uploaded it. */
export async function contestMediaDELETE(
  admin: Admin,
  mediaId: string,
  scope: CompetitionScope | null,
  userId: string
): Promise<NextResponse> {
  const { data: media, error: readError } = await admin
    .from('contest_media')
    .select('id, contest_id, storage_path, uploaded_by')
    .eq('id', mediaId)
    .maybeSingle();
  if (readError && isMissingTableError(readError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const loaded = await loadContestWithComp(admin, media.contest_id as string);
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  if (access.authority === 'participant' && media.uploaded_by !== userId) {
    return NextResponse.json(
      { error: 'Only the competition owner can remove media you didn’t upload' },
      { status: 403 }
    );
  }
  const { error } = await admin.from('contest_media').delete().eq('id', mediaId);
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the media' }, { status: 500 });
  }
  await admin.storage.from('uploads').remove([media.storage_path as string]);
  await revalidateOrgSiteForCompetition(admin, loaded.comp.id);
  return NextResponse.json({ success: true });
}

/** Owner-only: flip the gallery-curation bit. Grants nothing by itself —
 *  R5's public gallery additionally requires every tagged athlete's
 *  photo consent. */
export async function contestMediaPublishPATCH(
  admin: Admin,
  mediaId: string,
  published: boolean,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const { data: media, error: readError } = await admin
    .from('contest_media')
    .select('id, contest_id')
    .eq('id', mediaId)
    .maybeSingle();
  if (readError && isMissingTableError(readError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const loaded = await loadContestWithComp(admin, media.contest_id as string);
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access || access.authority !== 'owner') {
    return NextResponse.json(
      { error: 'Only the competition owner curates the gallery' },
      { status: 403 }
    );
  }
  const { error } = await admin
    .from('contest_media')
    .update({ published })
    .eq('id', mediaId);
  if (error) {
    console.error(`${TAG} publish error:`, error);
    return NextResponse.json({ error: 'Failed to update the media' }, { status: 500 });
  }
  // R5: the public gallery reads the curation bit — purge the site.
  await revalidateOrgSiteForCompetition(admin, loaded.comp.id);
  return NextResponse.json({ success: true, published });
}

/** Tag athletes on one media item. The set is the roster of the contest's
 *  participating teams (narrowed by authority); tombstones are never
 *  resurrected; guardians and the athlete are belled. */
export async function contestMediaTagPOST(
  admin: Admin,
  mediaId: string,
  profileIds: string[],
  scope: CompetitionScope | null,
  taggedBy: string
): Promise<NextResponse> {
  const { data: media, error: readError } = await admin
    .from('contest_media')
    .select('id, contest_id')
    .eq('id', mediaId)
    .maybeSingle();
  if (readError && isMissingTableError(readError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const loaded = await loadContestWithComp(admin, media.contest_id as string);
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const teams = await allowedContestTeams(admin, media.contest_id as string, access);
  const roster = await rosterByTeam(admin, [...teams]);
  const taggable = new Set([...roster.values()].flatMap(s => [...s]));
  for (const profileId of profileIds) {
    if (!taggable.has(profileId)) {
      // The attribution gate again: roster of a participating team or nothing.
      return NextResponse.json(
        { error: 'Only athletes on a participating team’s roster can be tagged' },
        { status: 400 }
      );
    }
  }

  // ON CONFLICT DO NOTHING via ignoreDuplicates: an existing row — active
  // OR tombstoned — is left untouched, so an untag is never undone here.
  const { data: inserted, error } = await admin
    .from('contest_media_tags')
    .upsert(
      profileIds.map(profileId => ({
        media_id: mediaId,
        profile_id: profileId,
        tagged_by: taggedBy,
      })),
      { onConflict: 'media_id,profile_id', ignoreDuplicates: true }
    )
    .select('profile_id');
  if (error) {
    console.error(`${TAG} tag error:`, error);
    return NextResponse.json({ error: 'Failed to tag' }, { status: 500 });
  }

  // Bells for the rows that actually landed (skipped tombstones bell no one).
  const landed = (inserted ?? []).map(r => r.profile_id as string);
  for (const profileId of landed) {
    const first = await profileFirstName(admin, profileId);
    await notifyGuardians(
      admin,
      profileId,
      {
        type: 'tag_alert',
        actorId: taggedBy,
        title: `${first} was tagged in team media`,
        message: 'A coach or team manager tagged them in photos from a game.',
        actionUrl: `/athlete/${profileId}?tab=tagged`,
      },
      taggedBy
    );
    if (profileId !== taggedBy) {
      await notifyUser(admin, profileId, {
        type: 'tag_alert',
        actorId: taggedBy,
        title: 'You were tagged in team media',
        message: 'A coach or team manager tagged you in photos from a game.',
        actionUrl: `/athlete/${profileId}?tab=tagged`,
      });
    }
  }
  await revalidateOrgSiteForCompetition(admin, loaded.comp.id);
  return NextResponse.json({ tagged: landed.length, skipped: profileIds.length - landed.length });
}

/** Org-side untag: flips to the tombstone (never deletes). */
export async function contestMediaTagDELETE(
  admin: Admin,
  mediaId: string,
  profileId: string,
  scope: CompetitionScope | null
): Promise<NextResponse> {
  const { data: media, error: readError } = await admin
    .from('contest_media')
    .select('id, contest_id')
    .eq('id', mediaId)
    .maybeSingle();
  if (readError && isMissingTableError(readError.code)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (!media) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const loaded = await loadContestWithComp(admin, media.contest_id as string);
  if (!loaded) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const access = await resolveCompetitionAccess(admin, loaded.comp, scope);
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await admin
    .from('contest_media_tags')
    .update({ status: 'removed' })
    .eq('media_id', mediaId)
    .eq('profile_id', profileId);
  if (error) {
    console.error(`${TAG} untag error:`, error);
    return NextResponse.json({ error: 'Failed to untag' }, { status: 500 });
  }
  await revalidateOrgSiteForCompetition(admin, loaded.comp.id);
  return NextResponse.json({ success: true });
}
