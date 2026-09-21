import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { optionalText, parseBody, uuid } from '@/lib/validation';
import { createTicket, readSubmitter, TicketsNotLive } from '@/lib/tickets/server';
import { resolveTarget } from '@/lib/tickets/snapshot-server';
import { formatTicketNumber } from '@/lib/tickets/number';
import { REPORT_REASONS, TICKET_LIMITS, type ReportReason } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/messages/reports — since Spec 2 a thin ADAPTER over the ticket
 * system: a DM report is a `report` ticket with a `message` or `profile`
 * target (the snapshot, the merge, the Critical intake, the guardian bell
 * for a supervised reporter all live in createTicket). The 019 table
 * `message_reports` stops growing; its 27 rows stay readable by the old
 * admin panel until it is removed.
 *
 * The old reasons (spam · harassment · hateful · sexual · violence · other)
 * map onto the one report list; the new sheet sends the new keys directly.
 */
const LEGACY_REASONS: Record<string, ReportReason> = {
  spam: 'spam_scam',
  harassment: 'harassment_bullying',
  hateful: 'hate_discrimination',
  sexual: 'sexual_content',
  violence: 'harassment_bullying',
  other: 'other',
};

const Body = z
  .object({
    reason: z.string().trim().min(1).max(64),
    details: optionalText(TICKET_LIMITS.description),
    messageId: uuid.optional(),
    reportedProfileId: uuid.optional(),
  })
  .refine(b => !!b.messageId || !!b.reportedProfileId, { path: ['messageId'], message: 'messageId or reportedProfileId is required' });

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'message-report', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const { reason: rawReason, details, messageId, reportedProfileId } = parsed.data;
    const reason = (REPORT_REASONS as readonly string[]).includes(rawReason) ? (rawReason as ReportReason) : LEGACY_REASONS[rawReason];
    if (!reason) return NextResponse.json({ error: 'Invalid reason' }, { status: 400, headers });

    const admin = getSupabaseAdmin();
    const target = await resolveTarget(admin, user.id, messageId ? { type: 'message', id: messageId } : { type: 'profile', id: reportedProfileId! });
    if (!target) return NextResponse.json({ error: messageId ? 'Message not found' : 'Profile not found' }, { status: 404, headers });

    const submitter = await readSubmitter(admin, user.id);
    const ticket = await createTicket(admin, {
      type: 'report',
      subtype: messageId ? 'dm' : 'profile',
      reason,
      description: details ?? '',
      submitter,
      target: { type: target.type, id: target.id, profileId: target.profileId, isMinor: target.isMinor, snapshot: target.snapshot, conversationId: target.conversationId },
    });
    return NextResponse.json({ id: ticket.id, number: formatTicketNumber(ticket.number), severity: ticket.severity }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers });
    reportRouteError('POST /api/messages/reports error:', error);
    return NextResponse.json({ error: 'Failed to file report' }, { status: 500, headers });
  }
}
