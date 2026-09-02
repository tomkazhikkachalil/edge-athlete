// ── Build while waiting (phase 7 C4) — provisioning at REQUEST time ─────────
// Tom's decision: keep the admin approval queue, but let the requester build
// while waiting. So the moment a request lands, the org exists (PENDING —
// approved_at NULL, migration 174) with its owner row, the OPTIONAL home
// course as a venue, and a DRAFT site shaped by its sport (C3) and seeded
// with the draft's contact. Approval stamps approved_at (the admin route
// adopts the org instead of creating one); a decline deletes the pending
// org (cascade), the request row keeping its name and drafts (FK SET NULL).
//
// BEST-EFFORT, AFTER the request row: the request is the deliverable; a
// failure here (pre-174 database, a missing catalog course) is logged and
// the admin path falls back to creating the org at approval as before.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createClubWithOwner } from '@/lib/clubs/create';
import { createLeagueWithOwner } from '@/lib/leagues/create';
import { SiteDraftSchema } from './wizard-validate';
import { siteDraftToContact, type OrgSide } from './approval';
import { orgVenueCreatePOST } from '@/lib/venues/org-venues-server';
import { siteCreatePOST } from '@/lib/org-sites/server';
import { courseDisplayName } from '@/lib/golf/tees';
import { signPreviewToken } from '@/lib/org-sites/preview-token';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the notify.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[PENDING ORG]';

export interface PendingRequestRow {
  id: string;
  requester_profile_id: string;
  name: string;
  description: string | null;
  sport_key?: string | null;
  place_id: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  location_source: string | null;
  operates_competitions: boolean | null;
  operates_teams: boolean | null;
  site_draft?: unknown;
}

export interface ProvisionResult {
  orgId: string;
  venueId: string | null;
  siteCreated: boolean;
}

export async function provisionPendingOrg(
  admin: Admin,
  side: OrgSide,
  row: PendingRequestRow
): Promise<ProvisionResult | null> {
  try {
    const draft = SiteDraftSchema.safeParse(row.site_draft ?? {});
    const siteDraft = draft.success ? draft.data : {};
    const shared = {
      name: row.name,
      description: row.description,
      ownerProfileId: row.requester_profile_id,
      placeColumns: {
        place_id: row.place_id,
        city: row.city,
        region: row.region,
        region_code: row.region_code,
        country: row.country,
        country_code: row.country_code,
        lat: row.lat,
        lng: row.lng,
        location_source: row.location_source,
      },
      capabilities:
        row.operates_competitions === null || row.operates_competitions === undefined
          ? undefined
          : { operatesCompetitions: row.operates_competitions, operatesTeams: row.operates_teams ?? false },
      approvedAt: null,
    };

    let orgId: string;
    if (side === 'club') {
      const created = await createClubWithOwner(admin, {
        ...shared,
        primarySport: siteDraft.sports?.[0] ?? null,
      });
      if ('error' in created) return null;
      orgId = created.club.id;
    } else {
      if (!row.sport_key) return null;
      const created = await createLeagueWithOwner(admin, { ...shared, sportKey: row.sport_key });
      if ('error' in created) return null;
      orgId = created.league.id;
    }

    // Pre-174 the column is absent and the org is LIVE (create.ts fell
    // back) — a live org must never be linked as "pending". Verify.
    const { data: check } = await admin
      .from(side === 'league' ? 'leagues' : 'clubs')
      .select('approved_at')
      .eq('id', orgId)
      .maybeSingle();
    if (!check || (check as { approved_at?: unknown }).approved_at !== null) {
      console.warn(`${TAG} no approval state (pre-174?) — rolling the provisioned ${side} back`);
      await admin.from(side === 'league' ? 'leagues' : 'clubs').delete().eq('id', orgId);
      return null;
    }

    const linkColumn = side === 'league' ? 'created_league_id' : 'created_club_id';
    await admin
      .from(side === 'league' ? 'league_requests' : 'club_requests')
      .update({ [linkColumn]: orgId })
      .eq('id', row.id)
      .eq('status', 'pending');

    // The OPTIONAL home course → a venue linked to the catalog row (169).
    let venueId: string | null = null;
    if (siteDraft.homeCourseId) {
      const { data: course } = await admin
        .from('golf_courses')
        .select('name, club_name')
        .eq('id', siteDraft.homeCourseId)
        .maybeSingle();
      if (course) {
        const res = await orgVenueCreatePOST(
          admin,
          { side, orgId },
          { name: courseDisplayName(course.club_name as string | null, course.name as string), golfCourseId: siteDraft.homeCourseId }
        );
        if (res.ok) {
          const body = (await res.json().catch(() => ({}))) as { venue?: { id?: string } };
          venueId = body.venue?.id ?? null;
        } else {
          console.warn(`${TAG} home-course venue failed:`, res.status);
        }
      }
    }

    // The DRAFT site: minted slug, the sport's module order + tagline
    // (C3 reads the org's sport), then the draft's contact.
    const siteRes = await siteCreatePOST(admin, side, orgId, row.name, null);
    const siteCreated = siteRes.ok;
    if (!siteCreated) {
      console.warn(`${TAG} draft site failed:`, siteRes.status);
    } else {
      const contact = siteDraftToContact(row.site_draft);
      if (contact) {
        await admin
          .from('org_sites')
          .update({ contact_config: contact })
          .eq(side === 'league' ? 'league_id' : 'club_id', orgId);
      }
    }
    return { orgId, venueId, siteCreated };
  } catch (error) {
    console.error(`${TAG} provision error:`, error);
    return null;
  }
}

/** The admin queue's "Preview draft site" links: org id → a signed preview
 *  URL for its site (any status). Missing sites, a missing secret or a
 *  pre-155 database → absent. */
export async function draftPreviewUrls(
  admin: Admin,
  side: OrgSide,
  orgIds: Array<string | null>
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const ids = [...new Set(orgIds.filter((id): id is string => !!id))];
  if (ids.length === 0) return out;
  const column = side === 'league' ? 'league_id' : 'club_id';
  const { data, error } = await admin.from('org_sites').select(`id, subdomain, ${column}`).in(column, ids);
  if (error || !data) return out;
  for (const site of data as unknown as Array<Record<string, unknown>>) {
    try {
      out.set(site[column] as string, `/org/${site.subdomain as string}/preview/${signPreviewToken(site.id as string)}`);
    } catch {
      /* no preview secret configured */
    }
  }
  return out;
}
