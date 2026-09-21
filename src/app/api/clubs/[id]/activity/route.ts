import { NextRequest, NextResponse } from 'next/server';
import { orgActivityGET } from '@/lib/affiliations/activity-server';
import { reportRouteError } from '@/lib/observability/report';

// The club's public recent-activity excerpt feed (connections PR D).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await orgActivityGET(request, 'club', id);
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[CLUB ACTIVITY] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
