import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';

// ── POST /api/messages/[conversationId]/escalate ─────────────────────────────
// "Show this to my guardian" (Wave 3): a supervised child flags a
// conversation for their guardians. The safety_alert carries a REFERENCE
// only — who, which conversation — never a transcript (standing line). The
// notification IS the record; deliberately not a message_reports row (that
// table is the admin-triage lifecycle, this is a family signal). Modeled on
// the reports route's reason-only guardian hook.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ conversationId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'guardian-escalate', { userId: user.id });
    if (limited) return limited;
    const { conversationId } = await params;
    const admin = getSupabaseAdmin();

    // Escalation is the CHILD's lever. Not flag-gated: safety behavior runs
    // unconditionally (Wave 1 inversion).
    const { data: me } = await admin
      .from('profiles')
      .select('supervision_state, first_name, display_name, full_name')
      .eq('id', user.id)
      .maybeSingle();
    if (me?.supervision_state !== 'supervised') {
      return NextResponse.json(
        { error: 'Only supervised athletes can send this to a guardian' },
        { status: 403 }
      );
    }

    // Active, unheld participant — a conversation the child can actually see.
    const { data: myRow } = await admin
      .from('conversation_participants')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('profile_id', user.id)
      .is('left_at', null)
      .is('held_at', null)
      .maybeSingle();
    if (!myRow) {
      return NextResponse.json({ error: 'Conversation not found' }, { status: 404 });
    }

    // The counterpart ref lets the guardian's console highlight the contact.
    const { data: others } = await admin
      .from('conversation_participants')
      .select('profile_id')
      .eq('conversation_id', conversationId)
      .neq('profile_id', user.id)
      .is('left_at', null)
      .limit(1);
    const counterpartId = others?.[0]?.profile_id ?? null;

    const childName = me.first_name || me.display_name || me.full_name || 'Your athlete';
    const { notifyGuardians } = await import('@/lib/guardian-notify');
    await notifyGuardians(admin, user.id, {
      type: 'safety_alert',
      title: `${childName} wants you to see a conversation`,
      message: 'They flagged a conversation for you. Open their console page to review the contact.',
      actionUrl: `/app/guardian/athlete/${user.id}${counterpartId ? `?contact=${counterpartId}` : ''}`,
      actorId: user.id,
      metadata: { conversation_id: conversationId, contact_profile_id: counterpartId },
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[MESSAGES] escalate error:', error);
    return NextResponse.json({ error: 'Could not notify your guardian' }, { status: 500 });
  }
}
