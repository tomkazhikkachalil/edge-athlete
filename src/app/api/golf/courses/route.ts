import { NextRequest, NextResponse } from 'next/server';
import { GolfCourseService } from '@/lib/golf-course-service';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('q') || '';
    const courseId = searchParams.get('id');
    const courseName = searchParams.get('name');
    const limit = parseInt(searchParams.get('limit') || '10');
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

    return NextResponse.json({
      courses: result.courses,
      total: result.total,
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