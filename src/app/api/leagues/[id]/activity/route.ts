import { NextRequest, NextResponse } from 'next/server';
import { orgActivityGET } from '@/lib/affiliations/activity-server';

// The league's public recent-activity excerpt feed (connections PR D).
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    return await orgActivityGET(request, 'league', id);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[LEAGUE ACTIVITY] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
