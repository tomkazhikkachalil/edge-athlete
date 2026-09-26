import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RECOVERY_NOTE_MAX } from '@/lib/authority/recovery';
import { cancelEvent, eventHost, makeEventPrivate, openRecovery, readEventPanel, readPeople, removeCoOrganizer, type Result } from '@/lib/authority/recovery-server';
import { reportRouteError } from '@/lib/observability/report';
import { correctCard, correctStatLine, readEventResults, reassignResult, removeMistakenResult } from '@/lib/results/correction-server';

/**
 * The event recovery panel (Authority PR 4). GET reads the host, the
 * organizers and the log; POST {action, ticket, note, …} re-hosts, removes a
 * co-organizer, cancels (before it starts) or makes it private (a live event
 * is never cancelled). Same gate, bucket and audit trail as the org panel.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const common = { ticket: z.string().trim().min(1).max(64), note: z.string().max(RECOVERY_NOTE_MAX).optional().nullable() };
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('host'), person: z.string().trim().min(1).max(320), keep_old_host: z.boolean().optional(), ...common }),
  z.object({ action: z.literal('remove_co_organizer'), participant: z.string().regex(UUID_RE), ...common }),
  z.object({ action: z.literal('cancel'), ...common }),
  z.object({ action: z.literal('make_private'), ...common }),
  // Results-kept (241): support corrects the results — a wrong person, a wrong score, a mistaken result.
  z.object({ action: z.literal('reassign_result'), participant: z.string().regex(UUID_RE), person: z.string().trim().min(1).max(320), ...common }),
  z.object({ action: z.literal('correct_card'), card: z.string().regex(UUID_RE), holes: z.array(z.object({ hole_number: z.number().int().min(1).max(18), strokes: z.number().int().min(1).max(20) })).min(1).max(18), ...common }),
  z.object({ action: z.literal('correct_line'), line: z.string().regex(UUID_RE), stats: z.record(z.string(), z.number()), ...common }),
  z.object({ action: z.literal('remove_result'), participant: z.string().regex(UUID_RE), ...common }),
]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireModerator(request, { intent: 'recover_authority' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const admin = getSupabaseAdmin();
    const panel = await readEventPanel(admin, id);
    if (!panel) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    // Results-kept (241): every participant's result per round — what support corrects.
    const results = await readEventResults(admin, id);
    const names = await readPeople(admin, results.map(r => r.profileId));
    return NextResponse.json({ ...panel, results: results.map(r => ({ ...r, person: names.get(r.profileId) ?? null })) }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/recovery/events/[id]]', error);
    return NextResponse.json({ error: 'Could not load the event' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'recover_authority' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const limited = await enforceRateLimit(request, 'authority-admin', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    const admin = getSupabaseAdmin();
    const opened = await openRecovery(admin, user.id, body.ticket, body.note);
    if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status, headers: NO_STORE });

    let result: Result<object>;
    switch (body.action) {
      case 'host': result = await eventHost(admin, opened.ctx, id, body.person, body.keep_old_host === true); break;
      case 'remove_co_organizer': result = await removeCoOrganizer(admin, opened.ctx, id, body.participant); break;
      case 'cancel': result = await cancelEvent(admin, opened.ctx, id); break;
      case 'make_private': result = await makeEventPrivate(admin, opened.ctx, id); break;
      case 'reassign_result': result = await reassignResult(admin, opened.ctx, id, body.participant, body.person); break;
      case 'correct_card': result = await correctCard(admin, opened.ctx, id, body.card, body.holes); break;
      case 'correct_line': result = await correctStatLine(admin, opened.ctx, id, body.line, body.stats); break;
      case 'remove_result': result = await removeMistakenResult(admin, opened.ctx, id, body.participant); break;
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/recovery/events/[id]]', error);
    return NextResponse.json({ error: 'Could not apply the change' }, { status: 500, headers: NO_STORE });
  }
}
