// Transfer-of-control engine (guardian-profiles Phase 5).
//
// The state machine is server-owned; routes only request transitions.
// Execution is an idempotent step journal (executed_steps) resumed by the
// daily cron — partial failures are safe: the reset token isn't issued until
// credential rotation succeeds, so there is never a lockout window.

import type { SupabaseClient } from '@supabase/supabase-js';
import { createHash, randomBytes } from 'crypto';
import {
  TRANSFER_COOLING_OFF_DAYS,
  TRANSFER_STEP_EXPIRY_DAYS,
  isUnderThreshold,
} from './config/minors-config';

export const ACTIVE_TRANSFER_STATES = [
  'eligible_notified', 'requested', 'initiated',
  'credentials_pending', 'dual_confirm', 'cooling_off', 'executing',
] as const;

export interface TransferRow {
  id: string;
  profile_id: string;
  state: string;
  initiated_by: string;
  athlete_contact_email: string | null;
  contact_verified_at: string | null;
  athlete_confirmed_at: string | null;
  guardian_confirmed_at: string | null;
  cooling_off_ends_at: string | null;
  executed_steps: string[];
  guardian_post_role: string | null;
  dob_snapshot: string;
  failure_count: number;
}

/** Abort if the profile's DOB diverged from the snapshot (anti-abuse). */
export async function abortIfDobDiverged(
  admin: SupabaseClient,
  transfer: TransferRow
): Promise<boolean> {
  const { data: profile } = await admin
    .from('profiles')
    .select('dob')
    .eq('id', transfer.profile_id)
    .maybeSingle();
  if (profile && profile.dob !== transfer.dob_snapshot) {
    await admin
      .from('profiles')
      .update({ dob_locked: true })
      .eq('id', transfer.profile_id);
    await admin
      .from('profile_transfers')
      .update({ state: 'aborted', failure_reason: 'dob_changed_mid_flow' })
      .eq('id', transfer.id);
    return true;
  }
  return false;
}

/**
 * Independent-contact check: the athlete's new email must not belong to any
 * guardian on the profile, any consent-record guardian snapshot, or any
 * other profile.
 */
export async function isContactIndependent(
  admin: SupabaseClient,
  profileId: string,
  email: string
): Promise<boolean> {
  const normalized = email.trim().toLowerCase().replace(/\+[^@]*@/, '@');
  const { data: guardians } = await admin
    .from('profile_access')
    .select('user_id, profiles!profile_access_user_id_fkey(email)')
    .eq('profile_id', profileId)
    .eq('role', 'guardian');
  for (const g of guardians ?? []) {
    const gEmail = (g as unknown as { profiles: { email: string } }).profiles?.email;
    if (gEmail && gEmail.toLowerCase().replace(/\+[^@]*@/, '@') === normalized) return false;
  }
  const { data: snapshots } = await admin
    .from('consent_records')
    .select('guardian_email_snapshot')
    .eq('profile_id', profileId);
  for (const s of snapshots ?? []) {
    if (s.guardian_email_snapshot?.toLowerCase().replace(/\+[^@]*@/, '@') === normalized) return false;
  }
  const { data: taken } = await admin
    .from('profiles')
    .select('id')
    .eq('email', email.trim().toLowerCase())
    .neq('id', profileId)
    .maybeSingle();
  if (taken) return false;
  return true;
}

/** 6-digit OTP through guardian_invites (transfer_contact_verify, 15 min). */
export async function issueContactOtp(
  admin: SupabaseClient,
  transferId: string,
  profileId: string,
  email: string
): Promise<string> {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await admin.from('guardian_invites').insert({
    token_hash: createHash('sha256').update(`${transferId}:${code}`).digest('hex'),
    invite_type: 'transfer_contact_verify',
    invited_email: email.trim().toLowerCase(),
    profile_id: profileId,
    expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
  return code;
}

export async function verifyContactOtp(
  admin: SupabaseClient,
  transferId: string,
  code: string
): Promise<boolean> {
  const { data } = await admin
    .from('guardian_invites')
    .update({ consumed_at: new Date().toISOString() })
    .eq('token_hash', createHash('sha256').update(`${transferId}:${code}`).digest('hex'))
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id')
    .maybeSingle();
  return !!data;
}

export function coolingOffEnd(): string {
  return new Date(Date.now() + TRANSFER_COOLING_OFF_DAYS * 86_400_000).toISOString();
}

export function stepExpiryCutoff(): string {
  return new Date(Date.now() - TRANSFER_STEP_EXPIRY_DAYS * 86_400_000).toISOString();
}

/**
 * Execute a transfer whose cooling-off has ended. Idempotent: each completed
 * step is journaled; re-entry skips finished steps. Order matters — the
 * reset token (last credential step) is only issued after rotation succeeds.
 */
export async function executeTransfer(
  admin: SupabaseClient,
  transfer: TransferRow,
  appUrl?: string
): Promise<{ ok: boolean; failedStep?: string }> {
  const steps: string[] = [...(transfer.executed_steps ?? [])];
  const journal = async (step: string) => {
    steps.push(step);
    await admin.from('profile_transfers')
      .update({ executed_steps: steps })
      .eq('id', transfer.id);
  };
  const done = (s: string) => steps.includes(s);

  try {
    if (await abortIfDobDiverged(admin, transfer)) return { ok: false, failedStep: 'dob_check' };

    // 1. Real email onto the shadow user.
    if (!done('set_email')) {
      const { error } = await admin.auth.admin.updateUserById(transfer.profile_id, {
        email: transfer.athlete_contact_email!,
        email_confirm: true,
      });
      if (error) throw new Error(`set_email: ${error.message}`);
      await journal('set_email');
    }
    // 2. Mirror into profiles.email.
    if (!done('mirror_email')) {
      const { error } = await admin.from('profiles')
        .update({ email: transfer.athlete_contact_email!.toLowerCase() })
        .eq('id', transfer.profile_id);
      if (error) throw new Error(`mirror_email: ${error.message}`);
      await journal('mirror_email');
    }
    // 3. Rotate credentials (revokes all sessions) + app-owned reset token.
    if (!done('rotate_credentials')) {
      const { error } = await admin.auth.admin.updateUserById(transfer.profile_id, {
        password: randomBytes(32).toString('base64url'),
      });
      if (error) throw new Error(`rotate: ${error.message}`);
      const raw = randomBytes(32).toString('base64url');
      await admin.from('guardian_invites').insert({
        token_hash: createHash('sha256').update(raw).digest('hex'),
        invite_type: 'athlete_activation',
        invited_email: transfer.athlete_contact_email!.toLowerCase(),
        profile_id: transfer.profile_id,
        expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      });
      // Email the activation link (best-effort; the token row is the source
      // of truth, and /forgot-password on the new email always works). A
      // crash before the journal below re-runs this step: a second valid
      // single-use token + duplicate email — harmless by design.
      if (appUrl && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
          const { emailService } = await import('./email-service');
          await emailService.sendAccountActivation(
            transfer.athlete_contact_email!.toLowerCase(),
            `${appUrl}/activate/${raw}`,
            appUrl
          );
        } catch (e) {
          console.error('[TRANSFERS] activation email failed:', e);
        }
      }
      await journal('rotate_credentials');
    }
    // 4. Flip access: supervised → owner; guardians → viewer/removed.
    if (!done('flip_access')) {
      const { error: ownerError } = await admin.from('profile_access')
        .update({ role: 'owner' })
        .eq('user_id', transfer.profile_id)
        .eq('profile_id', transfer.profile_id)
        .eq('role', 'supervised');
      if (ownerError) throw new Error(`flip owner: ${ownerError.message}`);
      if (transfer.guardian_post_role === 'removed') {
        await admin.from('profile_access')
          .delete()
          .eq('profile_id', transfer.profile_id)
          .eq('role', 'guardian');
      } else {
        await admin.from('profile_access')
          .update({ role: 'viewer' })
          .eq('profile_id', transfer.profile_id)
          .eq('role', 'guardian');
      }
      await admin.from('profile_access_audit').insert({
        profile_id: transfer.profile_id,
        user_id: transfer.profile_id,
        action: 'role_changed',
        old_role: 'supervised',
        new_role: 'owner',
        actor_id: transfer.profile_id,
      });
      await journal('flip_access');
    }
    // 5. Finalize.
    if (!done('finalize')) {
      await admin.from('profiles')
        .update({ supervision_state: 'self' })
        .eq('id', transfer.profile_id);
      // Digest routing ends with supervision: the guardian opted the child's
      // digest ON at creation (they were the recipient); the new adult owner
      // starts at the platform default (opt-in, false) — best-effort.
      await admin.from('notification_preferences')
        .update({ email_enabled: false })
        .eq('user_id', transfer.profile_id);
      await admin.from('profile_transfers')
        .update({ state: 'completed', completed_at: new Date().toISOString(), executed_steps: steps })
        .eq('id', transfer.id);
      await journal('finalize');
    }
    return { ok: true };
  } catch (err) {
    const failure_count = (transfer.failure_count ?? 0) + 1;
    await admin.from('profile_transfers')
      .update({
        failure_count,
        failure_reason: err instanceof Error ? err.message : 'unknown',
        ...(failure_count >= 3 ? { state: 'failed' } : {}),
      })
      .eq('id', transfer.id);
    return { ok: false, failedStep: err instanceof Error ? err.message : 'unknown' };
  }
}

/**
 * Daily sweep: flag newly-eligible supervised profiles, expire stalled
 * transfers, execute those past cooling-off. Returns a summary.
 */
export async function runTransferSweep(admin: SupabaseClient, appUrl?: string) {
  const today = new Date().toISOString().slice(0, 10);
  const summary = { flagged: 0, expired: 0, executed: 0, failed: 0 };

  // 1. Eligibility: supervised profiles past their threshold, no active transfer.
  const { data: supervised } = await admin
    .from('profiles')
    .select('id, dob, jurisdiction, minor_threshold_age')
    .eq('supervision_state', 'supervised')
    .not('dob', 'is', null);
  for (const p of supervised ?? []) {
    if (isUnderThreshold(p.dob, p.jurisdiction, today)) continue;
    const { data: existing } = await admin
      .from('profile_transfers')
      .select('id')
      .eq('profile_id', p.id)
      .in('state', [...ACTIVE_TRANSFER_STATES])
      .maybeSingle();
    if (existing) continue;
    const { error } = await admin.from('profile_transfers').insert({
      profile_id: p.id,
      state: 'eligible_notified',
      initiated_by: 'system',
      dob_snapshot: p.dob,
    });
    if (!error) {
      summary.flagged++;
      // Make the state's name honest: until Aug 2026 'eligible_notified'
      // notified NOBODY. Best-effort bell to every guardian.
      const { notifyGuardians, profileFirstName } = await import('./guardian-notify');
      await notifyGuardians(admin, p.id, {
        type: 'transfer_update',
        title: `${await profileFirstName(admin, p.id)} is old enough to take over their account`,
        actionUrl: `/app/transfer/${p.id}`,
      });
    }
  }

  // 2. Expire stalled intermediate states (14 days without progress).
  const { data: stalled } = await admin
    .from('profile_transfers')
    .update({ state: 'expired' })
    .in('state', ['requested', 'credentials_pending', 'dual_confirm'])
    .lt('updated_at', stepExpiryCutoff())
    .select('id');
  summary.expired = stalled?.length ?? 0;

  // 3. Execute past-cooling-off (and resume stuck executing).
  const { data: due } = await admin
    .from('profile_transfers')
    .select('*')
    .or(`state.eq.executing,and(state.eq.cooling_off,cooling_off_ends_at.lte.${new Date().toISOString()})`);
  for (const t of due ?? []) {
    if (t.state === 'cooling_off') {
      await admin.from('profile_transfers')
        .update({ state: 'executing' })
        .eq('id', t.id)
        .eq('state', 'cooling_off');
    }
    const result = await executeTransfer(admin, { ...t, state: 'executing' } as TransferRow, appUrl);
    if (result.ok) summary.executed++;
    else summary.failed++;
  }

  return summary;
}
