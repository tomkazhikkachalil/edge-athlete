import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { requireAuth, getSupabaseAdmin, getProfileRole } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import {
  abortIfDobDiverged,
  isContactIndependent,
  issueContactOtp,
  verifyContactOtp,
  coolingOffEnd,
  type TransferRow,
} from '@/lib/transfers';
import { emailService } from '@/lib/email-service';

// ── POST /api/transfers/[id] — state transitions ──────────────────────────────
// { action: 'submit_contact' | 'verify_contact' | 'confirm' | 'cancel', ... }
// Guardian confirm on a 'requested' transfer = approval → initiated.
// Cooling-off is the LAST exit: nothing cancels once executing.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { id } = await params;
    const admin = getSupabaseAdmin();
    const { data: transfer } = await admin
      .from('profile_transfers')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (!transfer) return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });

    const role = await getProfileRole(user.id, transfer.profile_id);
    if (role !== 'guardian' && role !== 'supervised') {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 });
    }
    if (await abortIfDobDiverged(admin, transfer as TransferRow)) {
      return NextResponse.json({ error: 'Transfer aborted: date-of-birth changed. Contact support.' }, { status: 409 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action as string;
    const terminal = ['completed', 'cancelled', 'expired', 'aborted', 'failed'];
    if (terminal.includes(transfer.state)) {
      return NextResponse.json({ error: 'This transfer is no longer active' }, { status: 410 });
    }

    // ── cancel: either party, any pre-executing state ─────────────────────
    if (action === 'cancel') {
      if (transfer.state === 'executing') {
        return NextResponse.json({ error: 'Too late to cancel — the transfer is executing. Contact support.' }, { status: 409 });
      }
      await admin.from('profile_transfers').update({
        state: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancel_reason: typeof body.reason === 'string' ? body.reason.slice(0, 200) : null,
      }).eq('id', id);
      return NextResponse.json({ ok: true, state: 'cancelled' });
    }

    // ── submit_contact: athlete adds the independent email ────────────────
    if (action === 'submit_contact') {
      if (role !== 'supervised') return NextResponse.json({ error: 'Only the athlete adds their contact' }, { status: 403 });
      if (!['initiated', 'credentials_pending'].includes(transfer.state)) {
        return NextResponse.json({ error: 'Not at the contact step yet' }, { status: 409 });
      }
      const email = typeof body.email === 'string' ? body.email.trim() : '';
      if (!email.includes('@')) return NextResponse.json({ error: 'Please enter a valid email.' }, { status: 400 });
      if (!(await isContactIndependent(admin, transfer.profile_id, email))) {
        return NextResponse.json(
          { error: 'This email is connected to a guardian or another account — the transfer needs an email that is yours alone.' },
          { status: 409 }
        );
      }
      const code = await issueContactOtp(admin, id, transfer.profile_id, email);
      if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
        try {
          await emailService.sendTransferCode(email, code, appUrl);
        } catch { /* code row is the source of truth */ }
      }
      await admin.from('profile_transfers')
        .update({ state: 'credentials_pending', athlete_contact_email: email.toLowerCase() })
        .eq('id', id);
      return NextResponse.json({ ok: true, state: 'credentials_pending' });
    }

    // ── verify_contact ────────────────────────────────────────────────────
    if (action === 'verify_contact') {
      if (role !== 'supervised') return NextResponse.json({ error: 'Only the athlete verifies their contact' }, { status: 403 });
      if (transfer.state !== 'credentials_pending') {
        return NextResponse.json({ error: 'Not at the verification step' }, { status: 409 });
      }
      const code = typeof body.code === 'string' ? body.code.trim() : '';
      if (!(await verifyContactOtp(admin, id, code))) {
        return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 });
      }
      await admin.from('profile_transfers')
        .update({ state: 'dual_confirm', contact_verified_at: new Date().toISOString() })
        .eq('id', id);
      return NextResponse.json({ ok: true, state: 'dual_confirm' });
    }

    // ── confirm: guardian approval / dual confirmation ────────────────────
    if (action === 'confirm') {
      if (role === 'guardian' && transfer.state === 'requested') {
        await admin.from('profile_transfers')
          .update({ state: 'initiated', guardian_confirmed_by: user.id })
          .eq('id', id);
        return NextResponse.json({ ok: true, state: 'initiated' });
      }
      if (transfer.state !== 'dual_confirm') {
        return NextResponse.json({ error: 'Not at the confirmation step' }, { status: 409 });
      }
      const patch: Record<string, unknown> = {};
      if (role === 'supervised') {
        patch.athlete_confirmed_at = new Date().toISOString();
        // The new owner chooses the guardian's post-transfer role.
        patch.guardian_post_role = body.guardianPostRole === 'removed' ? 'removed' : 'viewer';
      } else {
        patch.guardian_confirmed_at = new Date().toISOString();
        patch.guardian_confirmed_by = user.id;
      }
      const bothConfirmed =
        (role === 'supervised' ? true : !!transfer.athlete_confirmed_at) &&
        (role === 'guardian' ? true : !!transfer.guardian_confirmed_at);
      if (bothConfirmed) {
        patch.state = 'cooling_off';
        patch.cooling_off_ends_at = coolingOffEnd();
      }
      await admin.from('profile_transfers').update(patch).eq('id', id);
      return NextResponse.json({
        ok: true,
        state: bothConfirmed ? 'cooling_off' : 'dual_confirm',
        coolingOffEndsAt: bothConfirmed ? patch.cooling_off_ends_at : null,
      });
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[TRANSFERS] action error:', error);
    Sentry.captureException(error, { tags: { area: 'transfers' } });
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
