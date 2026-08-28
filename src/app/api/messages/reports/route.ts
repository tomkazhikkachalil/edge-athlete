import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';

const VALID_REASONS = new Set(['spam', 'harassment', 'hateful', 'sexual', 'violence', 'other']);
const MAX_DETAILS_LEN = 1000;

// ── POST /api/messages/reports ──────────────────────────────────────────────
// File a report against a message and/or profile.
// Body: { reason, details?, messageId?, conversationId?, reportedProfileId? }
//
// If messageId is supplied we resolve conversationId + reportedProfileId from
// the message itself (defensive — clients shouldn't be trusted to provide
// the correct reported profile for a message). reportedProfileId is otherwise
// required for profile-level reports.
export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'message-report', { userId: user.id });
    if (limited) return limited;

    const body = await request.json();
    const { reason, details, messageId, reportedProfileId } = body as {
      reason?: string;
      details?: string;
      messageId?: string;
      reportedProfileId?: string;
    };

    if (!reason || !VALID_REASONS.has(reason)) {
      return NextResponse.json({ error: 'Invalid reason' }, { status: 400 });
    }

    const trimmedDetails = typeof details === 'string' ? details.trim() : '';
    if (trimmedDetails.length > MAX_DETAILS_LEN) {
      return NextResponse.json({ error: 'Details too long' }, { status: 400 });
    }

    let conversationId: string | null = null;
    let reportedProfile: string | null = null;
    let resolvedMessageId: string | null = null;

    if (messageId) {
      const { data: message } = await supabase
        .from('messages')
        .select('id, sender_id, conversation_id')
        .eq('id', messageId)
        .maybeSingle();

      if (!message) {
        return NextResponse.json({ error: 'Message not found' }, { status: 404 });
      }

      // Caller must be an active participant of that conversation.
      const { data: participant } = await supabase
        .from('conversation_participants')
        .select('id')
        .eq('conversation_id', message.conversation_id)
        .eq('profile_id', user.id)
        .is('left_at', null)
        .is('held_at', null)
        .maybeSingle();

      if (!participant) {
        return NextResponse.json({ error: 'Cannot report this message' }, { status: 403 });
      }

      if (message.sender_id === user.id) {
        return NextResponse.json({ error: 'Cannot report own message' }, { status: 400 });
      }

      resolvedMessageId = message.id;
      conversationId = message.conversation_id;
      reportedProfile = message.sender_id;
    } else if (reportedProfileId) {
      if (reportedProfileId === user.id) {
        return NextResponse.json({ error: 'Cannot report yourself' }, { status: 400 });
      }
      // Verify the profile exists; cheap sanity check.
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', reportedProfileId)
        .maybeSingle();
      if (!profile) {
        return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
      }
      reportedProfile = profile.id;
    } else {
      return NextResponse.json({ error: 'messageId or reportedProfileId is required' }, { status: 400 });
    }

    const { data: inserted, error: insertError } = await supabase
      .from('message_reports')
      .insert({
        message_id: resolvedMessageId,
        conversation_id: conversationId,
        reported_profile_id: reportedProfile,
        reporter_id: user.id,
        reason,
        details: trimmedDetails || null,
      })
      .select('id')
      .single();

    if (insertError || !inserted) {
      console.error('POST /api/messages/reports insert error:', insertError);
      return NextResponse.json({ error: 'Failed to file report' }, { status: 500 });
    }

    // Round I: a supervised child filing a report is exactly the moment a
    // guardian wants to know about. The bell carries the REASON only — never
    // message content (the no-conversation-visibility line stays bright);
    // admins triage the report itself. Best-effort.
    const { data: reporter } = await supabase
      .from('profiles')
      .select('supervision_state, first_name')
      .eq('id', user.id)
      .maybeSingle();
    if (reporter?.supervision_state === 'supervised') {
      const { notifyGuardians } = await import('@/lib/guardian-notify');
      await notifyGuardians(supabase, user.id, {
        type: 'safety_alert',
        title: `${reporter.first_name || 'Your athlete'} reported someone`,
        message: `Reason: ${reason}. Our team will review it — you may also want to check in with them.`,
        actionUrl: `/app/guardian/athlete/${user.id}`,
        actorId: user.id,
        metadata: { report_id: inserted.id, reason },
      }, user.id);
    }

    return NextResponse.json({ id: inserted.id });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('POST /api/messages/reports error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
