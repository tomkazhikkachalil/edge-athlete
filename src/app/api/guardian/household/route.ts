import { NextRequest, NextResponse } from 'next/server';
import { requireGuardianAccount, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { parseHouseholdPolicy } from '@/lib/household-policy';

// ── /api/guardian/household ──────────────────────────────────────────────────
// The guardian's household safety defaults (Wave 4, mig 132) — the
// vitals-privacy pattern: the whole body passes through parseHouseholdPolicy
// (unknown keys and bad values silently dropped, defaults back-filled), so
// the stored JSON is always in-contract. Always the caller's OWN profiles
// row — per-guardian by design (co-guardians may differ; the audit feed and
// deviation chips make any overwrite visible).

export async function GET(request: NextRequest) {
  try {
    const { user } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const { data } = await admin
      .from('profiles')
      .select('household_policy')
      .eq('id', user.id)
      .maybeSingle();
    return NextResponse.json({ policy: parseHouseholdPolicy(data?.household_policy) });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household policy GET error:', error);
    return NextResponse.json({ error: 'Could not load household defaults' }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const body = await request.json().catch(() => undefined);
    if (body === undefined) {
      return NextResponse.json({ error: 'Invalid policy body' }, { status: 400 });
    }
    // null body = un-adopt (store NULL); anything else sanitizes to contract.
    const policy = body === null ? null : parseHouseholdPolicy(body);
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ household_policy: policy })
      .eq('id', user.id);
    if (error) {
      console.error('[GUARDIAN] household policy update error:', error);
      return NextResponse.json({ error: 'Could not save household defaults' }, { status: 500 });
    }
    return NextResponse.json({ policy });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household policy PATCH error:', error);
    return NextResponse.json({ error: 'Could not save household defaults' }, { status: 500 });
  }
}
