/**
 * Org-manager venues (phase 6b A1) — the shared core behind the
 * /api/{leagues,clubs}/[id]/venues twins (the structure-server shape: the
 * route is a thin gate, the query lives here).
 *
 * Venues are the property half of the venue/org split (141): a golf club is
 * an ORGANIZATION that competes and a PROPERTY with courses. Managers now
 * own their org's venues and can RECOGNIZE a catalog course on one — the
 * golf_club_id / golf_course_id pair (169) — which is what makes the org
 * pages and the public site show real courses, tees and scorecards.
 *
 * Reads are anonymous-tolerant (venues/facilities/golf_courses are all
 * public-SELECT reference tables); writes are manager-gated by the route.
 * Every write purges the org's published site (revalidateOrgSiteForOrg).
 */

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from '@/lib/orgs/authz';
import { revalidateOrgSiteForOrg } from '@/lib/org-sites/revalidate';
import {
  CATALOG_ROW_COLUMNS,
  getCatalogRow,
  rowToCourse,
  type CatalogRow,
} from '@/lib/golf/course-catalog';
import type { GolfCourse } from '@/types/golf';
import {
  golfLinkColumns,
  isMissingTableError,
  placeToVenueColumns,
  type OrgVenueCreateInput,
  type OrgVenuePatchInput,
} from '@/lib/venues/validate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG VENUES]';
const MISSING_COLUMN = '42703';

export interface OrgVenueScope {
  side: OrgSide;
  orgId: string;
}

export interface OrgVenueFacility {
  id: string;
  name: string;
  kind: string | null;
}

export interface OrgVenue {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  facilities: OrgVenueFacility[];
  golfClubId: string | null;
  golfCourseId: string | null;
  /** Linked catalog courses — every section of a linked club, or the one
   *  linked course. Empty when unlinked. */
  courses: GolfCourse[];
}

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

const VENUE_FIELDS = 'id, name, city, region, country, golf_club_id, golf_course_id';
/** Pre-169 select (no golf_course_id) — the 42703 retry. */
const VENUE_FIELDS_PRE_169 = 'id, name, city, region, country, golf_club_id';

interface VenueRow {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  golf_club_id: string | null;
  golf_course_id?: string | null;
}

/** Venues for one org, with facilities and linked courses. Never throws;
 *  a missing table or column reads as an empty list. */
export async function listOrgVenues(admin: Admin, scope: OrgVenueScope): Promise<OrgVenue[]> {
  const col = orgColumn(scope.side);
  const selectVenues = (fields: string) =>
    admin
      .from('venues')
      .select(fields)
      .eq(col, scope.orgId)
      .order('name', { ascending: true })
      .limit(50);
  let res: { data: unknown[] | null; error: { code?: string; message?: string } | null } =
    await selectVenues(VENUE_FIELDS);
  if (res.error?.code === MISSING_COLUMN) res = await selectVenues(VENUE_FIELDS_PRE_169);
  if (res.error) {
    if (!isMissingTableError(res.error.code)) console.error(`${TAG} list error:`, res.error);
    return [];
  }
  const rows = (res.data ?? []) as VenueRow[];
  if (rows.length === 0) return [];

  const venueIds = rows.map(v => v.id);
  const clubIds = [...new Set(rows.map(v => v.golf_club_id).filter((id): id is string => !!id))];
  const courseIds = [
    ...new Set(rows.map(v => v.golf_course_id ?? null).filter((id): id is string => !!id)),
  ];

  const [facilitiesRes, byClubRes, byIdRes] = await Promise.all([
    admin
      .from('facilities')
      .select('id, venue_id, name, kind')
      .in('venue_id', venueIds)
      .order('name', { ascending: true }),
    clubIds.length
      ? admin
          .from('golf_courses')
          .select(CATALOG_ROW_COLUMNS)
          .in('club_id', clubIds)
          .order('section_name', { ascending: true })
      : Promise.resolve({ data: [] as unknown[], error: null }),
    courseIds.length
      ? admin.from('golf_courses').select(CATALOG_ROW_COLUMNS).in('id', courseIds)
      : Promise.resolve({ data: [] as unknown[], error: null }),
  ]);

  const facilitiesByVenue = new Map<string, OrgVenueFacility[]>();
  for (const f of facilitiesRes.data ?? []) {
    if (!facilitiesByVenue.has(f.venue_id)) facilitiesByVenue.set(f.venue_id, []);
    facilitiesByVenue.get(f.venue_id)!.push({
      id: f.id as string,
      name: f.name as string,
      kind: (f.kind ?? null) as string | null,
    });
  }
  const coursesByClub = new Map<string, GolfCourse[]>();
  for (const row of (byClubRes.data ?? []) as unknown as CatalogRow[]) {
    const clubId = row.club_id as string;
    if (!coursesByClub.has(clubId)) coursesByClub.set(clubId, []);
    coursesByClub.get(clubId)!.push(rowToCourse(row));
  }
  const coursesById = new Map<string, GolfCourse>();
  for (const row of (byIdRes.data ?? []) as unknown as CatalogRow[]) {
    coursesById.set(row.id, rowToCourse(row));
  }

  return rows.map(v => {
    const linkedCourse = v.golf_course_id ? coursesById.get(v.golf_course_id) : undefined;
    return {
      id: v.id,
      name: v.name,
      city: v.city ?? null,
      region: v.region ?? null,
      country: v.country ?? null,
      facilities: facilitiesByVenue.get(v.id) ?? [],
      golfClubId: v.golf_club_id ?? null,
      golfCourseId: v.golf_course_id ?? null,
      courses: v.golf_club_id
        ? (coursesByClub.get(v.golf_club_id) ?? [])
        : linkedCourse
          ? [linkedCourse]
          : [],
    };
  });
}

export async function orgVenuesGET(admin: Admin, scope: OrgVenueScope): Promise<NextResponse> {
  return NextResponse.json({ venues: await listOrgVenues(admin, scope) });
}

/** Resolve a catalog pick to the golf link pair; null pick = unlink. */
async function resolveGolfLink(
  admin: Admin,
  golfCourseId: string | null | undefined
): Promise<
  | { ok: true; columns: { golf_club_id: string | null; golf_course_id: string | null } }
  | { ok: false; response: NextResponse }
> {
  if (!golfCourseId) return { ok: true, columns: golfLinkColumns(null) };
  const row = await getCatalogRow(admin, golfCourseId);
  if (!row) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Golf course not found' }, { status: 404 }),
    };
  }
  return { ok: true, columns: golfLinkColumns(row) };
}

/** Pre-169 database: a SELECT names the column → 42703; a write BODY
 *  names it → PostgREST's own PGRST204 ("column not in schema cache").
 *  Both read as "migration pending", never a 500. */
function isPre169(error: { code?: string } | null): boolean {
  return error?.code === MISSING_COLUMN || error?.code === 'PGRST204';
}

const PRE_169_RESPONSE = () =>
  NextResponse.json(
    { error: 'Golf course links need a database migration first (169)' },
    { status: 409 }
  );

/** POST — create a venue for the org (optionally linked + with facilities). */
export async function orgVenueCreatePOST(
  admin: Admin,
  scope: OrgVenueScope,
  input: OrgVenueCreateInput
): Promise<NextResponse> {
  const link = await resolveGolfLink(admin, input.golfCourseId);
  if (!link.ok) return link.response;

  const insert: Record<string, unknown> = {
    name: input.name,
    [orgColumn(scope.side)]: scope.orgId,
    ...placeToVenueColumns(input.place),
    golf_club_id: link.columns.golf_club_id,
  };
  // Only send the 169 column when it carries a value, so a pre-169 database
  // can still create an unlinked venue.
  if (link.columns.golf_course_id) insert.golf_course_id = link.columns.golf_course_id;

  const { data: venue, error } = await admin.from('venues').insert(insert).select('id').single();
  if (error || !venue) {
    if (isPre169(error)) return PRE_169_RESPONSE();
    console.error(`${TAG} insert error:`, error);
    return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
  }

  if (input.facilities && input.facilities.length > 0) {
    const { error: facilityError } = await admin
      .from('facilities')
      .insert(input.facilities.map(f => ({ venue_id: venue.id, name: f.name, kind: f.kind ?? null })));
    if (facilityError) {
      // No PostgREST transaction: keep the venue, report the partial state.
      console.error(`${TAG} facilities insert error:`, facilityError);
      return NextResponse.json(
        { error: 'Venue created but facilities failed — add them individually' },
        { status: 500 }
      );
    }
  }

  await revalidateOrgSiteForOrg(admin, scope.side, scope.orgId);
  const venues = await listOrgVenues(admin, scope);
  return NextResponse.json({ venue: venues.find(v => v.id === venue.id) ?? { id: venue.id } });
}

/** PATCH — rename, re-place, link/unlink a golf course. The org-column
 *  filter on the UPDATE is the security line: a foreign venueId 404s. */
export async function orgVenuePATCH(
  admin: Admin,
  scope: OrgVenueScope,
  venueId: string,
  input: OrgVenuePatchInput
): Promise<NextResponse> {
  const update: Record<string, unknown> = {};
  if (input.name !== undefined) update.name = input.name;
  if (input.place !== undefined) Object.assign(update, placeToVenueColumns(input.place));
  if (input.golfCourseId !== undefined) {
    const link = await resolveGolfLink(admin, input.golfCourseId);
    if (!link.ok) return link.response;
    Object.assign(update, link.columns);
  }

  const { data, error } = await admin
    .from('venues')
    .update(update)
    .eq('id', venueId)
    .eq(orgColumn(scope.side), scope.orgId)
    .select('id');
  if (error) {
    if (isPre169(error)) return PRE_169_RESPONSE();
    console.error(`${TAG} update error:`, error);
    return NextResponse.json({ error: 'Failed to update venue' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }

  await revalidateOrgSiteForOrg(admin, scope.side, scope.orgId);
  const venues = await listOrgVenues(admin, scope);
  return NextResponse.json({ venue: venues.find(v => v.id === venueId) ?? { id: venueId } });
}

/** DELETE — remove the venue (facilities cascade; events SET NULL). */
export async function orgVenueDELETE(
  admin: Admin,
  scope: OrgVenueScope,
  venueId: string
): Promise<NextResponse> {
  const { data, error } = await admin
    .from('venues')
    .delete()
    .eq('id', venueId)
    .eq(orgColumn(scope.side), scope.orgId)
    .select('id');
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete venue' }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
  }
  await revalidateOrgSiteForOrg(admin, scope.side, scope.orgId);
  return NextResponse.json({ ok: true });
}
