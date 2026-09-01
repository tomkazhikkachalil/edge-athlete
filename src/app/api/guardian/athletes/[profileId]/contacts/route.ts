import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { UUID_RE } from '@/lib/uuid';
import { contactState, earliestIso, volumeBand } from '@/lib/contact-roster';

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

// The metadata-only roster: partner identity, first contact, volume band,
// standing state. Caps at the 50 most recent conversations; head-counts only
// (covered by idx_messages_conv_time); NEVER message content.
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ profileId: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { profileId } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ contacts: [] });
    }
    const role = await getProfileRole(user.id, profileId);
    if (role !== 'guardian') {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }
    const admin = getSupabaseAdmin();

    // The child's direct conversations — held and left rows included
    // (history matters to a parent), newest-touched first, capped.
    const { data: childRows, error: childError } = await admin
      .from('conversation_participants')
      .select('conversation_id, held_at, left_at, conversation:conversations!inner(id, type, created_at, updated_at)')
      .eq('profile_id', profileId)
      .eq('conversation.type', 'direct')
      .limit(50);
    if (childError) throw childError;

    const convIds = (childRows ?? []).map(r => r.conversation_id);
    const heldByConv = new Map(
      (childRows ?? []).map(r => [r.conversation_id, Boolean(r.held_at)])
    );
    const convCreatedAt = new Map(
      (childRows ?? []).map(r => {
        const conv = r.conversation as unknown as { created_at: string } | { created_at: string }[];
        const c = Array.isArray(conv) ? conv[0] : conv;
        return [r.conversation_id, c?.created_at ?? null] as const;
      })
    );

    const [counterpartsQ, ledgerQ, blocksQ] = await Promise.all([
      convIds.length > 0
        ? admin
            .from('conversation_participants')
            .select('conversation_id, profile_id, profiles:profile_id (id, first_name, last_name, full_name, handle, avatar_url)')
            .in('conversation_id', convIds)
            .neq('profile_id', profileId)
        : Promise.resolve({ data: [], error: null }),
      admin
        .from('approved_contacts')
        .select('contact_profile_id, status, source, created_at')
        .eq('child_profile_id', profileId),
      admin
        .from('user_blocks')
        .select('blocker_id, blocked_id')
        .or(`blocker_id.eq.${profileId},blocked_id.eq.${profileId}`),  // hardening-ok: guardian-gate-validated id
    ]);
    for (const q of [counterpartsQ, ledgerQ, blocksQ]) {
      if (q.error) throw q.error;
    }

    const blockedIds = new Set(
      (blocksQ.data ?? [])
        .flatMap(b => [b.blocker_id, b.blocked_id])
        .filter(id => id !== profileId)
    );
    const ledgerByContact = new Map(
      (ledgerQ.data ?? []).map(l => [l.contact_profile_id, l])
    );

    // Head-count per conversation (metadata only — the band, never the count).
    const counts = await Promise.all(
      convIds.map(async convId => {
        const { count } = await admin
          .from('messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', convId)
          .is('deleted_at', null);
        return [convId, count ?? 0] as const;
      })
    );
    const countByConv = new Map(counts);

    // One row per contact person (a contact with several severed threads
    // still appears once — earliest first-contact, summed volume).
    const byContact = new Map<string, {
      profile: { id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null; avatar_url: string | null };
      firstContactAt: string | null;
      messageCount: number;
      held: boolean;
    }>();
    for (const row of counterpartsQ.data ?? []) {
      const raw = (row as { profiles: unknown }).profiles;
      const profile = (Array.isArray(raw) ? raw[0] : raw) as {
        id: string; first_name: string | null; last_name: string | null;
        full_name: string | null; handle: string | null; avatar_url: string | null;
      } | null;
      if (!profile) continue;
      const existing = byContact.get(profile.id) ?? {
        profile,
        firstContactAt: null,
        messageCount: 0,
        held: false,
      };
      existing.firstContactAt = earliestIso(
        existing.firstContactAt,
        convCreatedAt.get(row.conversation_id) ?? null
      );
      existing.messageCount += countByConv.get(row.conversation_id) ?? 0;
      existing.held = existing.held || (heldByConv.get(row.conversation_id) ?? false);
      byContact.set(profile.id, existing);
    }
    // Ledger-only contacts (approved via follow, no thread yet) are
    // deliberately absent — the roster is about conversations that exist.
    const contacts = [...byContact.values()].map(entry => {
      const ledger = ledgerByContact.get(entry.profile.id);
      return {
        profileId: entry.profile.id,
        firstName: entry.profile.first_name,
        lastName: entry.profile.last_name,
        fullName: entry.profile.full_name,
        handle: entry.profile.handle,
        avatarUrl: entry.profile.avatar_url,
        firstContactAt: earliestIso(entry.firstContactAt, ledger?.created_at ?? null),
        volumeBand: volumeBand(entry.messageCount),
        state: contactState({
          blocked: blockedIds.has(entry.profile.id),
          held: entry.held,
          ledgerStatus: (ledger?.status as 'approved' | 'denied' | undefined) ?? null,
        }),
        source: ledger?.source ?? null,
      };
    });
    contacts.sort((a, b) => (b.firstContactAt ?? '').localeCompare(a.firstContactAt ?? ''));

    return NextResponse.json({ contacts });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] contacts roster error:', error);
    return NextResponse.json({ error: 'Could not load contacts' }, { status: 500 });
  }
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
