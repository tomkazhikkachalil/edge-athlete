import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { freezeConversation, hideContent, setModerationState, unfreezeConversation, unhideContent } from '@/lib/moderation/server';
import type { TicketRow } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/admin/tickets/[id]/actions { action } — the one-click actions
 * BEFORE a decision (Support & Reporting, Spec 2): hide / unhide the reported
 * post or comment, freeze / unfreeze the reported thread, limit / lift the
 * reported account. Each stamps the ticket and appends `action_taken`. The
 * decision itself is the resolution code on PATCH — that IS the action.
 */
const ACTIONS = ['hide', 'unhide', 'freeze', 'unfreeze', 'limit', 'lift'] as const;
const Body = z.object({ action: z.enum(ACTIONS) });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'work_queue' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const { action } = parsed.data;

    const admin = getSupabaseAdmin();
    const { data } = await admin.from('tickets').select('id, type, target_type, target_id, target_profile_id, content_snapshot').eq('id', id).maybeSingle();
    const t = data as Pick<TicketRow, 'id' | 'type' | 'target_type' | 'target_id' | 'target_profile_id' | 'content_snapshot'> | null;
    if (!t) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    if (t.type !== 'report') return NextResponse.json({ error: 'Only a report has actions.' }, { status: 409, headers: NO_STORE });

    const conversationId = t.target_type === 'conversation' ? t.target_id : t.target_type === 'message' ? ((t.content_snapshot?.conversation_id as string | undefined) ?? null) : null;
    const contentKind = t.target_type === 'post' ? 'post' : t.target_type === 'comment' ? 'comment' : null;
    let ok = false;
    switch (action) {
      case 'hide':
      case 'unhide':
        if (!contentKind || !t.target_id) return NextResponse.json({ error: 'This report is not about a post or comment.' }, { status: 409, headers: NO_STORE });
        ok = action === 'hide' ? await hideContent(admin, contentKind, t.target_id, t.id, user.id) : await unhideContent(admin, contentKind, t.target_id, t.id, user.id);
        break;
      case 'freeze':
      case 'unfreeze':
        if (!conversationId) return NextResponse.json({ error: 'This report is not about a conversation.' }, { status: 409, headers: NO_STORE });
        ok = action === 'freeze' ? await freezeConversation(admin, conversationId, t.id, user.id) : await unfreezeConversation(admin, conversationId, t.id, user.id);
        break;
      case 'limit':
      case 'lift':
        if (!t.target_profile_id) return NextResponse.json({ error: 'This report names no user.' }, { status: 409, headers: NO_STORE });
        ok = await setModerationState(admin, t.target_profile_id, action === 'limit' ? 'limited' : 'active', { ticketId: t.id, actorId: user.id, note: action === 'limit' ? 'admin' : 'lifted by admin' });
        break;
    }
    if (!ok) return NextResponse.json({ error: 'That did not work — is migration 223 live?' }, { status: 503, headers: NO_STORE });
    return NextResponse.json({ ok: true, action }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/tickets/[id]/actions]', error);
    return NextResponse.json({ error: 'Could not apply the action' }, { status: 500, headers: NO_STORE });
  }
}
