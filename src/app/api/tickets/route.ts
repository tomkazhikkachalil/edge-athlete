import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { boundedText, optionalText, parseBody, uuid } from '@/lib/validation';
import { createTicket, readMyTickets, readSubmitter, readTicketsAboutMe, readerScope, TicketsNotLive, type CreateTicketInput } from '@/lib/tickets/server';
import { resolveTarget } from '@/lib/tickets/snapshot-server';
import { TICKET_LIMITS, TICKET_TARGET_TYPES, TICKET_TYPES, isReasonForType, type TicketSubtype, type TicketTargetType } from '@/lib/tickets/types';
import { formatTicketNumber } from '@/lib/tickets/number';
import { parsePublicUrl } from '@/lib/media/proxy-url';
import { reportRouteError } from '@/lib/observability/report';
import { recoveryTicketFields } from '@/lib/authority/recovery-server';

/**
 * /api/tickets — a user's own tickets (Support & Reporting, Spec 1).
 *
 *   POST { type, reason, subject?, description, contact_ok? } → { id, number, severity }
 *     Spec 1 files `help`, `suggestion`, and a `report` with no target (the
 *     Help Center's "report an incident" — subtype 'incident'). Spec 2 adds
 *     the targeted report shapes with their snapshots. A supervised profile
 *     may file; its guardians hear.
 *   GET → { supported, tickets } — My requests: the caller's own tickets plus
 *     their supervised athletes' (a guardian reads the child's).
 *
 * Pre-222: GET answers supported:false; POST answers 503 by name.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const CreateBody = z
  .object({
    type: z.enum(TICKET_TYPES),
    reason: boundedText(64),
    subject: optionalText(TICKET_LIMITS.subject),
    // A targeted report needs no words (the snapshot is the evidence); everything else does.
    description: optionalText(TICKET_LIMITS.description),
    contact_ok: z.boolean().optional(),
    // Spec 2: a report filed FROM the thing — the server resolves and snapshots it.
    target: z.object({ type: z.enum(TICKET_TARGET_TYPES), id: uuid }).optional(),
    // Spec 3: a screenshot from POST /api/tickets/attachment — re-asserted below to be THIS user's.
    attachment_url: optionalText(600),
    // Authority (240): the recovery request names the club, league or event in words (a link, a domain, a name).
    reference: optionalText(500),
  })
  .refine(b => isReasonForType(b.type, b.reason), { path: ['reason'], message: 'Pick a reason from the list.' })
  .refine(b => b.type === 'report' || !b.target, { path: ['target'], message: 'Only a report names a target.' })
  .refine(b => !!b.target || !!b.description, { path: ['description'], message: 'Tell us what happened.' })
  .refine(b => !b.reference || (b.type === 'help' && b.reason === 'recovery'), { path: ['reference'], message: 'Only a recovery request names a club, league or event.' });

const SUBTYPE_FOR_TARGET: Record<TicketTargetType, TicketSubtype> = { post: 'post', comment: 'comment', profile: 'profile', conversation: 'dm', message: 'dm', org: 'org', sport_event: 'sport_event' };

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'ticket-create', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, CreateBody);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;

    const admin = getSupabaseAdmin();
    const submitter = await readSubmitter(admin, user.id);
    let attachmentUrl: string | null = null;
    if (body.attachment_url) {
      const parsed = parsePublicUrl(body.attachment_url);
      if (!parsed || parsed.bucket !== 'uploads' || !parsed.key.startsWith(`${user.id}/tickets/`)) {
        return NextResponse.json({ error: 'That screenshot is not yours to attach.' }, { status: 400, headers: NO_STORE });
      }
      attachmentUrl = body.attachment_url;
    }
    let target: CreateTicketInput['target'] = null;
    if (body.target) {
      const resolved = await resolveTarget(admin, user.id, body.target);
      // Not visible to the reporter (or their own content): a 404, never a 403.
      if (!resolved) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
      target = { type: resolved.type, id: resolved.id, profileId: resolved.profileId, isMinor: resolved.isMinor, snapshot: resolved.snapshot, conversationId: resolved.conversationId };
    }
    // Authority (240): the recovery request — the same 201 whatever the reference matches (existence is never disclosed).
    let description = body.description ?? '';
    if (body.type === 'help' && body.reason === 'recovery') {
      const fields = await recoveryTicketFields(admin, body.reference, description);
      description = fields.description;
      target = fields.target;
    }
    const ticket = await createTicket(admin, {
      type: body.type,
      subtype: body.type === 'report' ? (target ? SUBTYPE_FOR_TARGET[target.type as TicketTargetType] : 'incident') : null,
      reason: body.reason,
      subject: body.subject ?? null,
      description,
      contact_ok: body.contact_ok,
      submitter,
      target,
      attachmentUrl,
    });
    return NextResponse.json({ id: ticket.id, number: formatTicketNumber(ticket.number), severity: ticket.severity, merged: ticket.mergedInto !== null }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof TicketsNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    reportRouteError('[POST /api/tickets]', error);
    return NextResponse.json({ error: 'Could not send your request. Please try again.' }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const scope = await readerScope(admin, user.id);
    const [result, about] = await Promise.all([readMyTickets(admin, scope), readTicketsAboutMe(admin, scope)]);
    return NextResponse.json({ supported: result.supported, tickets: result.items, aboutMe: about.items }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/tickets]', error);
    return NextResponse.json({ error: 'Could not load your requests' }, { status: 500, headers: NO_STORE });
  }
}
