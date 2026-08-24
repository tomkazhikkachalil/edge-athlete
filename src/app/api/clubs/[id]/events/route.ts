import { NextRequest, NextResponse } from 'next/server';
import { orgEventsGET } from '@/lib/calendar/org-events-server';

// The club's public upcoming-events schedule (119). Logic lives in the
// shared core — one code path, two org kinds.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await orgEventsGET(request, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CLUB EVENTS] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
