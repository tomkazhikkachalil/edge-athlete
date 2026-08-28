import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName } from '@/lib/formatters';

// ── GET /api/guardian/audit ──────────────────────────────────────────────────
// The FIRST reader of safety_settings_audit (091 anticipated exactly this:
// "a future console view reads through the API"). The guardian's household
// safety feed: every recorded posture change across their managed athletes —
// who changed what, old → new. Scope deliberately includes PARKED athletes
// (history stays readable while restore is possible) but not transferred
// ones (their guardian row became viewer). Table is RLS-on/zero-policies —
// service-role only, so this route IS the read path.

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      return NextResponse.json({ events: [] });
    }
    const admin = getSupabaseAdmin();

    const { data: accessRows } = await admin
      .from('profile_access')
      .select('profile_id')
      .eq('user_id', user.id)
      .eq('role', 'guardian');
    const ids = (accessRows ?? []).map(r => r.profile_id);
    if (ids.length === 0) {
      return NextResponse.json({ error: 'Guardian access required' }, { status: 403 });
    }

    const { data: rows, error } = await admin
      .from('safety_settings_audit')
      .select('id, profile_id, actor_id, field, old_value, new_value, created_at')
      .in('profile_id', ids)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    // Two batched name lookups: athletes + distinct actors. An actor who no
    // longer exists (audit has no FKs by design) renders as "a guardian".
    const actorIds = [...new Set((rows ?? []).map(r => r.actor_id).filter(Boolean))] as string[];
    const nameIds = [...new Set([...ids, ...actorIds])];
    const { data: profiles } = await admin
      .from('profiles')
      .select('id, first_name, last_name, full_name, display_name, handle')
      .in('id', nameIds);
    const nameById = new Map(
      (profiles ?? []).map(p => [
        p.id,
        {
          id: p.id,
          name: formatDisplayName(p.first_name, null, p.last_name, p.display_name ?? p.full_name),
          handle: p.handle as string | null,
        },
      ])
    );

    const events = (rows ?? []).map(r => ({
      id: r.id,
      createdAt: r.created_at,
      field: r.field,
      oldValue: r.old_value,
      newValue: r.new_value,
      athlete: nameById.get(r.profile_id) ?? { id: r.profile_id, name: 'A former athlete', handle: null },
      actor: r.actor_id ? nameById.get(r.actor_id) ?? null : null,
    }));

    return NextResponse.json({ events });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GUARDIAN] audit feed error:', error);
    return NextResponse.json({ error: 'Could not load the safety log' }, { status: 500 });
  }
}
