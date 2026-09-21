import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { readQueue, type QueueFilters } from '@/lib/tickets/server';
import { TICKET_SEVERITIES, TICKET_STATUSES, TICKET_TYPES } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/admin/tickets?status=open|all|<status>&type=&severity=&q= — the
 * support queue (Support & Reporting, Spec 1): open tickets sorted severity
 * first, then age; an `overdue` flag per row; the open counts by type and
 * severity in the same payload. `q` matches a ticket number (`EA-1042`) or
 * the subject. Owner or moderator (intent work_queue). Pre-222 answers
 * supported:false with an empty queue.
 */
export async function GET(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    await requireModerator(request, { intent: 'work_queue' });
    const sp = request.nextUrl.searchParams;
    const filters: QueueFilters = {};
    const status = sp.get('status');
    if (status === 'open' || status === 'all' || (TICKET_STATUSES as readonly string[]).includes(status ?? '')) filters.status = status as QueueFilters['status'];
    const type = sp.get('type');
    if (type && (TICKET_TYPES as readonly string[]).includes(type)) filters.type = type as QueueFilters['type'];
    const severity = sp.get('severity');
    if (severity && (TICKET_SEVERITIES as readonly string[]).includes(severity)) filters.severity = severity as QueueFilters['severity'];
    const q = sp.get('q')?.trim();
    if (q) filters.q = q.slice(0, 80);

    const result = await readQueue(getSupabaseAdmin(), filters);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/tickets]', error);
    return NextResponse.json({ error: 'Could not load the queue' }, { status: 500, headers });
  }
}
