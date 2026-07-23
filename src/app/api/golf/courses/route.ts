import { NextRequest, NextResponse } from 'next/server';
import { GolfCourseService } from '@/lib/golf-course-service';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import type { GolfCourse } from '@/lib/golf-courses-db';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const courseId = searchParams.get('id');
    const courseName = searchParams.get('name');
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '10', 10) || 10, 1), 100);
    const useLocalOnly = searchParams.get('localOnly') === 'true';
    const country = searchParams.get('country') || undefined;
    const state = searchParams.get('state') || undefined;

    // Get specific course by ID (checks local first, then APIs if available)
    if (courseId) {
      const course = await GolfCourseService.getCourseById(courseId);
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      return NextResponse.json({ course, source: course.id.startsWith('api-') || course.id.startsWith('igolf-') || course.id.startsWith('zyla-') ? 'api' : 'local' });
    }

    // Get specific course by name (checks local first, then APIs if available)
    if (courseName) {
      const course = await GolfCourseService.getCourseByName(courseName);
      if (!course) {
        return NextResponse.json({ error: 'Course not found' }, { status: 404 });
      }
      return NextResponse.json({ course, source: course.id.startsWith('api-') || course.id.startsWith('igolf-') || course.id.startsWith('zyla-') ? 'api' : 'local' });
    }

    // Hybrid search (local database + APIs when available)
    const result = await GolfCourseService.searchCourses({
      query,
      limit,
      useLocalOnly,
      country,
      state
    });

    // ── "Courses you've played" layer ────────────────────────────────────
    // Real courses come from real rounds: merge distinct courses already
    // logged on the platform (the requester's own first — repeat rounds at
    // a home course are the common case). Par/rating/slope auto-fill from
    // the most recent round there. No fake data; gets better as the
    // platform grows.
    let historyCourses: GolfCourse[] = [];
    try {
      let viewerId: string | null = null;
      try {
        const user = await requireAuth(request);
        viewerId = user.id;
      } catch { /* anonymous search still gets platform courses */ }

      if (query.length >= 2) {
        const admin = getSupabaseAdmin();
        const { data: roundCourses } = await admin
          .from('golf_rounds')
          .select('profile_id, course, course_location, par, holes, tee, course_rating, slope_rating, date')
          .ilike('course', `%${query.replace(/[\%_]/g, '\\$&')}%`)
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
          const tee = ['black', 'blue', 'white', 'gold', 'red'].includes(r.tee) ? r.tee : 'white';
          const course: GolfCourse = {
            id: `history-${key.replace(/[^a-z0-9]+/g, '-')}`,
            name: r.course.trim(),
            location: { city, state, country: '' },
            courseRating: r.course_rating ? { [tee]: r.course_rating } : {},
            slopeRating: r.slope_rating ? { [tee]: r.slope_rating } : {},
            totalPar: r.holes === 9 && r.par ? r.par * 2 : (r.par || 72),
            totalYardage: {},
            holes: [],
          } as GolfCourse;
          if (viewerId && r.profile_id === viewerId) own.push(course);
          else platform.push(course);
        }
        historyCourses = [...own, ...platform].slice(0, 5);
      }
    } catch (historyError) {
      console.error('Course history layer failed (non-fatal):', historyError);
    }

    // Merge: history first (dedupe static/API results against it by name)
    const historyNames = new Set(historyCourses.map(c => c.name.toLowerCase()));
    const mergedCourses = [
      ...historyCourses,
      ...result.courses.filter(c => !historyNames.has(c.name.toLowerCase())),
    ].slice(0, limit);

    return NextResponse.json({
      courses: mergedCourses,
      total: mergedCourses.length,
      source: result.source,
      query: result.query,
      // Include API status for debugging
      apiStatus: {
        golfApiEnabled: process.env.GOLF_API_ENABLED === 'true' && !!process.env.GOLF_API_KEY,
        iGolfEnabled: process.env.IGOLF_API_ENABLED === 'true' && !!process.env.IGOLF_API_KEY,
        zylaGolfEnabled: process.env.ZYLA_GOLF_API_ENABLED === 'true' && !!process.env.ZYLA_GOLF_API_KEY
      }
    });

  } catch (error) {
    console.error('Golf courses API error:', error);
    return NextResponse.json({ error: 'Failed to search courses' }, { status: 500 });
  }
}