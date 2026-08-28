import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { UUID_RE } from '@/lib/uuid';

// ── /api/guardian/athletes/[profileId]/contacts ──────────────────────────────
// The guardian's contact ledger for one child (Wave 3, mig 131). POST decides
// a held first contact: approve clears the hold (the thread appears in the
// child's list with its unread count — no retro notifications); deny is the
// QUIET REMOVAL Tom chose — sever both participant rows like a leave, tell
// nobody, and let a retry re-hold. GET (the metadata-only roster) lands in
// the next PR.

/** Shared direct conversations between the child and one contact. */
async function sharedDirectConversationIds(
  admin: ReturnType<typeof getSupabaseAdmin>,
  childId: string,
  contactId: string
): Promise<string[]> {
  const { data: childRows } = await admin
    .from('conversation_participants')
    .select('conversation_id, conversation:conversations!inner(type)')
    .eq('profile_id', childId)
    .eq('conversation.type', 'direct');
  const childConvIds = (childRows ?? []).map(r => r.conversation_id);
  if (childConvIds.length === 0) return [];
  const { data: contactRows } = await admin
    .from('conversation_participants')
    .select('conversation_id')
    .eq('profile_id', contactId)
    .in('conversation_id', childConvIds);
  return (contactRows ?? []).map(r => r.conversation_id);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const role = await getProfileRole(user.id, profileId);
    if (role !== 'guardian') {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }

    const body = await request.json().catch(() => ({}));
    const contactProfileId =
      typeof body.contactProfileId === 'string' && UUID_RE.test(body.contactProfileId)
        ? body.contactProfileId
        : null;
    const decision = body.decision === 'approve' || body.decision === 'deny' ? body.decision : null;
    if (!contactProfileId || !decision) {
      return NextResponse.json(
        { error: "contactProfileId and decision ('approve'|'deny') are required" },
        { status: 400 }
      );
    }

    const admin = getSupabaseAdmin();
    const { error: ledgerError } = await admin.from('approved_contacts').upsert(
      {
        child_profile_id: profileId,
        contact_profile_id: contactProfileId,
        status: decision === 'approve' ? 'approved' : 'denied',
        source: 'guardian_decision',
        decided_by: user.id,
        decided_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'child_profile_id,contact_profile_id' }
    );
    if (ledgerError) {
      console.error('[GUARDIAN] contact decision ledger error:', ledgerError);
      return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 });
    }

    const convIds = await sharedDirectConversationIds(admin, profileId, contactProfileId);
    if (convIds.length > 0) {
      if (decision === 'approve') {
        // The thread simply appears for the child, unread count intact.
        await admin
          .from('conversation_participants')
          .update({ held_at: null })
          .in('conversation_id', convIds)
          .eq('profile_id', profileId)
          .not('held_at', 'is', null);
      } else {
        // Quiet removal: sever both rows (the leave/block shape), clear the
        // hold. No notifications in any direction.
        await admin
          .from('conversation_participants')
          .update({ left_at: new Date().toISOString(), held_at: null })
          .in('conversation_id', convIds)
          .in('profile_id', [profileId, contactProfileId]);
      }
    }

    return NextResponse.json({ ok: true, status: decision === 'approve' ? 'approved' : 'denied' });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] contact decision error:', error);
    return NextResponse.json({ error: 'Could not record the decision' }, { status: 500 });
  }
}
