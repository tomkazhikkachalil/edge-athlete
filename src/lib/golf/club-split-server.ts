import type { SupabaseClient } from '@supabase/supabase-js';
import type { CatalogRow, ClubSectionFound } from '@/lib/golf/course-catalog';

// The one writer of a club split (Nov 19 2026, Tom: split the club into its
// courses). The rule that finds the courses is pure and lives with the other
// candidate rules (course-catalog.ts clubSectionsFromCandidates); this file
// only writes what it found. `club_id` here is golf_courses.club_id →
// golf_clubs: a golf club's courses, never an organisation.

export interface ClubSectionRow { id: string; name: string; sectionName?: string; sectionKind?: string; holesCount?: number }

/** Write the split: the club (`golf_clubs`), the row linked to it as the club's
 *  generic row, and one catalog row per course, WITHOUT a card (never
 *  fabricated: each course's card arrives when someone picks it, by the
 *  normal lookup, which holds a section to a listing that names it).
 *  Re-runnable: the club is found by the row's link, the course rows are
 *  insert-if-absent on (external_source, external_id). Reversible by hand:
 *  delete the `seed` rows `split:<row id>:…` and null the row's club_id.
 *  Returns the club and its course rows, or null when a write failed. */
export async function splitClubIntoSections(
  admin: SupabaseClient,
  row: CatalogRow,
  sections: ClubSectionFound[]
): Promise<{ club: { id: string; name: string }; siblings: ClubSectionRow[] } | null> {
  let clubId = row.club_id;
  if (!clubId) {
    const { data: club, error } = await admin
      .from('golf_clubs')
      .insert({ name: row.name, city: row.city, region: row.region, region_code: row.region_code, country: row.country, country_code: row.country_code, place_id: row.place_id, lat: row.lat, lng: row.lng })
      .select('id')
      .single();
    if (error || !club) {
      console.error(`[course-catalog] club split: no club for ${row.id}:`, error?.message);
      return null;
    }
    clubId = club.id as string;
    // Only a row still unlinked takes the link: a concurrent split keeps its own.
    const linked = await admin.from('golf_courses').update({ club_id: clubId, club_name: row.name, section_kind: 'unspecified' }).eq('id', row.id).is('club_id', null).select('id');
    if (linked.error || !linked.data?.length) {
      await admin.from('golf_clubs').delete().eq('id', clubId);
      const { data: now } = await admin.from('golf_courses').select('club_id').eq('id', row.id).maybeSingle();
      clubId = (now?.club_id as string | null) ?? null;
      if (!clubId) return null;
    }
  }
  const rows = sections.map(s => ({
    external_source: 'seed' as const,
    external_id: `split:${row.id}:${s.label.toLowerCase().replace(/\s+/g, '-')}`,
    name: `${row.name} (${s.label})`,
    club_id: clubId,
    club_name: row.name,
    section_name: s.label,
    section_kind: 'unspecified',
    city: row.city, region: row.region, region_code: row.region_code, country: row.country, country_code: row.country_code,
    location_source: row.location_source, place_id: row.place_id, lat: row.lat, lng: row.lng,
    // Nov 20 2026: a course of the club is on the club's website (Angus Glen's
    // two courses were made without it and could not be read from it).
    website: row.website ?? null,
    course_rating: {}, slope_rating: {},
  }));
  const { error: insertError } = await admin.from('golf_courses').upsert(rows, { onConflict: 'external_source,external_id', ignoreDuplicates: true });
  if (insertError) {
    console.error(`[course-catalog] club split: course rows for ${row.id}:`, insertError.message);
    return null;
  }
  const { data: siblings } = await admin.from('golf_courses').select('id, name, section_name, section_kind, holes_count').eq('club_id', clubId).neq('id', row.id).order('section_name', { ascending: true }).limit(20);
  console.warn(`[course-catalog] club split: ${row.id} "${row.name}" → ${sections.map(s => s.label).join(', ')}`);
  return {
    club: { id: clubId, name: row.name },
    siblings: (siblings ?? []).map(x => ({ id: x.id as string, name: x.name as string, sectionName: (x.section_name as string | null) ?? undefined, sectionKind: (x.section_kind as string | null) ?? undefined, holesCount: (x.holes_count as number | null) ?? undefined })),
  };
}

/** The lookup's door: only a row NOT yet linked to a club is split (a club
 *  split before, or curated by hand, keeps what it has). Returns the split and
 *  the row as it now reads, or null. */
export async function splitUnlinkedClub(
  admin: SupabaseClient,
  row: CatalogRow,
  sections: ClubSectionFound[]
): Promise<{ club: { id: string; name: string }; siblings: ClubSectionRow[]; row: CatalogRow } | null> {
  if (row.club_id) return null;
  const split = await splitClubIntoSections(admin, row, sections);
  return split ? { ...split, row: { ...row, club_id: split.club.id, section_kind: row.section_kind ?? 'unspecified' } as CatalogRow } : null;
}
