import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';

// ── PATCH /api/guardian/risk-signals/[id] ────────────────────────────────────
// Acknowledge one risk signal (Wave 7, mig 137): stamps acknowledged_at/by so
// the row leaves the hub queue. GUARDIAN-ONLY — the signal's child profile is
// looked up first and the caller must hold the guardian role on it (viewers
// can see the hub, but acknowledging is a decision). Idempotent: a second
// acknowledge is a no-op success. There is no un-acknowledge on purpose —
// like the audit feed, what a guardian has seen stays seen.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: 'Invalid signal id' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();

    const { data: signal } = await admin
      .from('risk_signals')
      .select('id, profile_id, acknowledged_at')
      .eq('id', id)
      .maybeSingle();
    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }
    const role = await getProfileRole(user.id, signal.profile_id);
    if (role !== 'guardian') {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }
    if (signal.acknowledged_at) {
      return NextResponse.json({ ok: true, already: true });
    }

    const { error: updateError } = await admin
      .from('risk_signals')
      .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user.id })
      .eq('id', id)
      .is('acknowledged_at', null);
    if (updateError) throw updateError;

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] risk-signal ack error:', error);
    return NextResponse.json({ error: 'Could not acknowledge the signal' }, { status: 500 });
  }
}
