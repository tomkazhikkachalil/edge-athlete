import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { optionalText, parseBody, uuid } from '@/lib/validation';
import { applyAdminPatch, deleteTicket, readTicketForAdmin, TicketsNotLive } from '@/lib/tickets/server';
import { RESOLUTION_CODES, SUGGESTION_TAGS, TICKET_LIMITS, TICKET_SEVERITIES, TICKET_STATUSES } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/admin/tickets/[id] (Support & Reporting, Spec 1)
 *
 *   GET    → the admin projection, ALL events with actor names, the reporter
 *            and target context (masked names, account age, prior tickets,
 *            the DERIVED strike count) and the assignable admins.
 *   PATCH  { status?, severity?, assignee_profile_id?, resolution_code?,
 *            resolution_note?, suggestion_tag? } — every change appends its
 *            history rows; resolving needs a code; resolved / closed bell +
 *            email the submitter; compare-and-set on updated_at (409).
 *   DELETE → OWNER-ONLY (intent delete_ticket). The history cascades.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const PatchBody = z
  .object({
    status: z.enum(TICKET_STATUSES).optional(),
    severity: z.enum(TICKET_SEVERITIES).optional(),
    assignee_profile_id: uuid.nullable().optional(),
    resolution_code: z.enum(RESOLUTION_CODES).nullable().optional(),
    resolution_note: optionalText(TICKET_LIMITS.resolutionNote).nullable(),
    suggestion_tag: z.enum(SUGGESTION_TAGS).nullable().optional(),
  })
  .strict();

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const detail = await readTicketForAdmin(getSupabaseAdmin(), id);
    if (!detail) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(detail, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/tickets/[id]]', error);
    return NextResponse.json({ error: 'Could not load the ticket' }, { status: 500, headers: NO_STORE });
  }
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const parsed = await parseBody(request, PatchBody);
    if (!parsed.success) return parsed.response;
    const patch = parsed.data;
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Nothing to change.' }, { status: 400, headers: NO_STORE });

    const outcome = await applyAdminPatch(getSupabaseAdmin(), id, user.id, {
      ...patch,
      resolution_note: patch.resolution_note === undefined ? undefined : (patch.resolution_note ?? null),
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
    return NextResponse.json({ ok: true, ticket: outcome.ticket }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    reportRouteError('[PATCH /api/admin/tickets/[id]]', error);
    return NextResponse.json({ error: 'Could not update the ticket' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireModerator(request, { intent: 'delete_ticket' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const gone = await deleteTicket(getSupabaseAdmin(), id);
    if (!gone) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    reportRouteError('[DELETE /api/admin/tickets/[id]]', error);
    return NextResponse.json({ error: 'Could not delete the ticket' }, { status: 500, headers: NO_STORE });
  }
}
