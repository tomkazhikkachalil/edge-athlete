import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, getSupabaseAdmin } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';

export const maxDuration = 60;

/**
 * POST /api/admin/account-purge — purge ONE parked account now instead of
 * waiting for the daily cron (departed accounts, Sep 24 2026). Owner-only
 * (requireAdmin — the storage sweep's shape). Body: { profileId, dryRun? }.
 * DRY RUN BY DEFAULT — the answer says what the engine WOULD do (`mode`:
 * erase | tombstone | masked, and the tied counts behind it); purging
 * requires an explicit { "dryRun": false }.
 *
 * Refuses a profile that is not parked (`deletion_requested_at` NULL) — it is
 * "purge now" for an account its owner already asked to delete, never a
 * delete of a live account — and a profile that already departed.
 */
export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const admin = getSupabaseAdmin();

    const body = await request.json().catch(() => ({}));
    const profileId = body?.profileId;
    if (typeof profileId !== 'string' || !isUuid(profileId)) {
      return NextResponse.json({ error: 'profileId must be a profile id' }, { status: 400 });
    }
    const dryRun = body?.dryRun !== false;

    const { data: profile, error } = await admin
      .from('profiles')
      .select('id, deletion_requested_at, departed_at')
      .eq('id', profileId)
      .maybeSingle();
    if (error) {
      reportRouteError('[account-purge] profile read:', error);
      return NextResponse.json({ error: 'Profile read failed' }, { status: 500 });
    }
    if (!profile) return NextResponse.json({ error: 'Profile not found' }, { status: 404 });
    if (profile.departed_at) return NextResponse.json({ error: 'This account has already departed' }, { status: 409 });
    if (!profile.deletion_requested_at) {
      return NextResponse.json({ error: 'Only a parked account (scheduled for deletion) can be purged' }, { status: 409 });
    }

    const { planDeparture, hardDeleteAccount } = await import('@/lib/account-deletion');
    const plan = await planDeparture(admin, profileId);
    if (dryRun) return NextResponse.json({ dryRun: true, ...plan });

    const result = await hardDeleteAccount(admin, profileId);
    return NextResponse.json({ dryRun: false, mode: result.mode, tied: plan.tied, warnings: result.warnings });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[account-purge] error:', error);
    return NextResponse.json({ error: 'Account purge failed' }, { status: 500 });
  }
}
