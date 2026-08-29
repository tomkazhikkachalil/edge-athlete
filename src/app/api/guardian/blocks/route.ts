import { NextRequest, NextResponse } from 'next/server';
import { requireGuardianAccount, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { enforceRateLimit } from '@/lib/rate-limit';
import { UUID_RE } from '@/lib/uuid';
import { applyBlock, removeBlock } from '@/lib/blocks';

// ── /api/guardian/blocks ─────────────────────────────────────────────────────
// Household-level blocking (Wave 4): one action blocks a person for the
// guardian AND every supervised athlete they manage — one household, one
// list (a person worth blocking for the children is worth blocking for the
// parent's own DMs). Each target loops the shared applyBlock semantics
// (upsert + follow-sever + DM close); user_blocks RLS is self-only, so this
// service-role route IS the household path.

function householdTargets(userId: string, athleteIds: string[]): string[] {
  return [userId, ...athleteIds];
}

export async function GET(request: NextRequest) {
  try {
    const { user, athleteIds } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ blocks: [] });
    }
    const admin = getSupabaseAdmin();
    const targets = householdTargets(user.id, athleteIds);
    const { data, error } = await admin
      .from('user_blocks')
      .select('blocker_id, created_at, blocked:blocked_id (id, first_name, middle_name, last_name, full_name, avatar_url, handle)')
      .in('blocker_id', targets)
      .order('created_at', { ascending: false });
    if (error) throw error;

    // Group per blocked person; `full` = every household member blocks them
    // (false renders a "partial" note — e.g. a block one child made alone).
    const byBlocked = new Map<string, { blocked: unknown; blockerIds: string[]; createdAt: string }>();
    for (const row of (data ?? []) as Array<{ blocker_id: string; created_at: string; blocked: unknown }>) {
      const raw = (row as { blocked: unknown }).blocked;
      const blocked = (Array.isArray(raw) ? raw[0] : raw) as { id: string } | null;
      if (!blocked) continue;
      const entry = byBlocked.get(blocked.id) ?? {
        blocked,
        blockerIds: [],
        createdAt: row.created_at,
      };
      entry.blockerIds.push(row.blocker_id);
      if (row.created_at < entry.createdAt) entry.createdAt = row.created_at;
      byBlocked.set(blocked.id, entry);
    }
    const blocks = [...byBlocked.values()].map(entry => ({
      blocked: entry.blocked,
      created_at: entry.createdAt,
      blockerIds: entry.blockerIds,
      full: entry.blockerIds.length === targets.length,
    }));
    return NextResponse.json({ blocks });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household blocks GET error:', error);
    return NextResponse.json({ error: 'Could not load the household block list' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, athleteIds } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const limited = await enforceRateLimit(request, 'guardian-block', { userId: user.id });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const blockedId =
      typeof body.blockedId === 'string' && UUID_RE.test(body.blockedId) ? body.blockedId : null;
    if (!blockedId) {
      return NextResponse.json({ error: 'Valid blockedId is required' }, { status: 400 });
    }
    const targets = householdTargets(user.id, athleteIds);
    if (targets.includes(blockedId)) {
      return NextResponse.json({ error: 'You cannot block a member of your household' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const appliedTo: string[] = [];
    for (const target of targets) {
      const result = await applyBlock(admin, target, blockedId);
      if (result.ok) appliedTo.push(target);
    }
    return NextResponse.json({ ok: true, appliedTo });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household blocks POST error:', error);
    return NextResponse.json({ error: 'Could not block for the household' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, athleteIds } = await requireGuardianAccount(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ error: 'Not available' }, { status: 404 });
    }
    const { searchParams } = new URL(request.url);
    const blockedId = searchParams.get('blockedId');
    if (!blockedId || !UUID_RE.test(blockedId)) {
      return NextResponse.json({ error: 'Valid blockedId is required' }, { status: 400 });
    }
    const admin = getSupabaseAdmin();
    for (const target of householdTargets(user.id, athleteIds)) {
      await removeBlock(admin, target, blockedId);
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] household blocks DELETE error:', error);
    return NextResponse.json({ error: 'Could not unblock for the household' }, { status: 500 });
  }
}
