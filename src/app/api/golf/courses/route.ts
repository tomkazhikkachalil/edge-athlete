import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { likePatternFor } from '@/lib/search/patterns';
import type { GolfCourse } from '@/types/golf';
import {
  searchCatalog,
  getCatalogRow,
  hydrateCourse,
  globalSearch,
  providersConfigured,
  consumeProviderBudget,
  catalogAttribution,
} from '@/lib/golf/course-catalog';
import { getCourseHoleGeometry } from '@/lib/golf/hole-geometry';

// ── GET /api/golf/courses ────────────────────────────────────────────────────
// The course picker's data source, over the golf_courses catalog (migration
// 100) plus the "courses you've played" harvest. External providers are
// touched only via ?global=1 (explicit worldwide search) and ?id= hydration —
// never per keystroke; see src/lib/golf/course-catalog.ts.
//
// Emits the FLAT types/golf.GolfCourse shape the composer consumes. (The old
// route emitted the static file's nested-location shape — city/state silently
// never rendered in the picker.)
export async function GET(request: NextRequest) {
  try {
    // IP-keyed: this endpoint is reachable anonymously and reads cross-user
    // course history — a catalog makes it a scraping target.
    const limited = await enforceRateLimit(request, 'course-search');
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const courseId = searchParams.get('id');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 100);
    const wantGlobal = searchParams.get('global') === '1';
    const admin = getSupabaseAdmin();

    // ── Course by id — the hydration touchpoint ──────────────────────────
    if (courseId) {
      // ?holes=1 — the per-hole OSM geometry cache (live map's hole-by-hole
      // view). Served from golf_courses for 30 days per attempt; a null
      // geometry is a real answer (no unambiguous OSM coverage).
      if (searchParams.get('holes') === '1') {
        const geometry = await getCourseHoleGeometry(admin, courseId, () =>
          consumeProviderBudget(admin, 'overpass')
        );
        return NextResponse.json({ geometry });
      }
      const row = await getCatalogRow(admin, courseId);
      if (!row) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      const course = await hydrateCourse(admin, row);
      return NextResponse.json({ course });
    }

    // ── Explicit worldwide search: fetch → upsert → fall through to the
    //    normal catalog read, which now includes the new rows ──────────────
    if (wantGlobal) {
      await globalSearch(admin, query);
    }

    // Location parameters (migration 104): ISO codes for the filters, a
    // "lat,lng" for near-me sorting. Malformed values are ignored, not 400s —
    // the picker must keep working whatever a stale client sends.
    const nearRaw = (searchParams.get('near') || '').split(',').map(Number);
    const near =
      nearRaw.length === 2 && nearRaw.every(Number.isFinite)
        ? { lat: nearRaw[0], lng: nearRaw[1] }
        : undefined;
    const radiusRaw = Number(searchParams.get('radius'));
    const catalogCourses = await searchCatalog(admin, query, limit, {
      countryCode: searchParams.get('country') || undefined,
      regionCode: searchParams.get('region') || undefined,
      near,
      radiusKm: Number.isFinite(radiusRaw) && radiusRaw > 0 ? Math.min(radiusRaw, 500) : undefined,
    });

    // ── "Courses you've played" layer ────────────────────────────────────
    // Real courses from real rounds — the viewer's own first (repeat rounds
    // at a home course are the common case). Rating/slope auto-fill from the
    // most recent round there. Non-fatal on any error.
    let historyCourses: GolfCourse[] = [];
    const historyCatalogIds = new Map<string, string>();
    try {
      let viewerId: string | null = null;
      try {
        const user = await requireAuth(request);
        viewerId = user.id;
      } catch { /* anonymous search still gets platform courses */ }

      // 1 char, like every other search: golf_rounds.course gained prefix and
      // trigram indexes in migration 087.
      if (query.length >= 1) {
        const { data: roundCourses } = await admin
          .from('golf_rounds')
          .select('profile_id, course, course_id, course_location, par, holes, tee, course_rating, slope_rating, date')
          // Prefix-only under 3 chars: '%a%' matched nearly every round ever
          // logged, which is what made 1-character course search noise.
          .ilike('course', likePatternFor(query))
          .order('date', { ascending: false })
          .limit(100);

        const seen = new Set<string>();
        const own: GolfCourse[] = [];
        const platform: GolfCourse[] = [];
        for (const r of roundCourses || []) {
          const key = r.course.trim().toLowerCase();
          if (!key || seen.has(key)) continue;
          seen.add(key);
          const [city = '', state = ''] = (r.course_location || '').split(',').map((x: string) => x.trim());
          // Free-text tees are legal now (catalog courses store real tee
          // names like "championship") — the old five-color whitelist keyed
          // such a round's rating under 'white', silently wrong.
          const tee = (r.tee ?? '').trim().toLowerCase() || 'white';
          const course: GolfCourse = {
            id: `history-${key.replace(/[^a-z0-9]+/g, '-')}`,
            name: r.course.trim(),
            city,
            state,
            courseRating: r.course_rating ? { [tee]: r.course_rating } : {},
            slopeRating: r.slope_rating ? { [tee]: r.slope_rating } : {},
            totalPar: r.holes === 9 && r.par ? r.par * 2 : (r.par || 72),
            holes: [],
          };
          // The round's catalog link, when it has one — the ONLY reliable
          // way to find "the" catalog row now that names collide (four rows
          // are named exactly "Eagle Creek Golf Club" since the OSM import).
          if (r.course_id) historyCatalogIds.set(course.id, r.course_id as string);
          if (viewerId && r.profile_id === viewerId) own.push(course);
          else platform.push(course);
        }
        historyCourses = [...own, ...platform].slice(0, 5);
      }
    } catch (historyError) {
      console.error('Course history layer failed (non-fatal):', historyError);
    }

    // Enrich history rows from the catalog row they shadow: history DEDUPES
    // the catalog below, so without this a course you'd played rendered
    // "0 holes" forever (the regression Tom hit). History keeps its OWN
    // rating/slope (the round's truth); holes/par/location come from the
    // catalog match.
    // Name map keeps the FIRST row per name — catalogCourses is already
    // best-ranked-first (richness breaks ties), and `new Map(entries)` kept
    // the LAST, which handed Tom's seeded Ottawa row the identity of an OSM
    // row in Indianapolis (prod probe, Aug 24). The round's own course_id
    // wins outright when the page contains it.
    const catalogByName = new Map<string, GolfCourse>();
    for (const c of catalogCourses) {
      const key = c.name.toLowerCase();
      if (!catalogByName.has(key)) catalogByName.set(key, c);
    }
    const catalogById = new Map(catalogCourses.map(c => [c.id, c]));
    const enrichedHistory = historyCourses.map(h => {
      const linkedId = historyCatalogIds.get(h.id);
      const match =
        (linkedId ? catalogById.get(linkedId) : undefined) ?? catalogByName.get(h.name.toLowerCase());
      if (!match) return h;
      // Keep the CATALOG id: the history row shadows the catalog row out of
      // the list (dedupe below), so if this kept its synthetic history-* id,
      // a repeat course could never link course_id again — no info card, no
      // map, no catalog join on any round at a course you'd played before.
      // History still wins on rating/slope (the round's truth).
      return {
        ...match,
        courseRating: Object.keys(h.courseRating).length ? h.courseRating : match.courseRating,
        slopeRating: Object.keys(h.slopeRating).length ? h.slopeRating : match.slopeRating,
      };
    });

    // Merge: history first, then catalog rows deduped against it by name.
    const historyNames = new Set(enrichedHistory.map(c => c.name.toLowerCase()));
    const mergedCourses = [
      ...enrichedHistory,
      ...catalogCourses.filter(c => !historyNames.has(c.name.toLowerCase())),
    ].slice(0, limit);

    return NextResponse.json({
      courses: mergedCourses,
      total: mergedCourses.length,
      // The UI may offer "Search all courses worldwide" only when a provider
      // is actually available server-side.
      globalAvailable: providersConfigured(),
      // ODbL compliance: the catalog is OpenStreetMap-sourced (directly, and
      // via OpenGolfAPI), so attribution is owed on EVERY response — the
      // picker shows it in its footer rather than tracking per-row
      // provenance client-side. Gating it on providers was a licence gap
      // once OSM rows became the bulk of the table.
      attribution: catalogAttribution(providersConfigured()),
    });
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error('Golf courses API error:', error);
    return NextResponse.json({ error: 'Failed to search courses' }, { status: 500 });
  }
}
