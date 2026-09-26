import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getProfileRole, getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { resolveProfileAction } from '@/lib/profile-roles';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { UUID_RE } from '@/lib/uuid';
import { readHiddenResults, setResultHidden } from '@/lib/results/hide-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/results/visibility — results-kept round (241, Tom: "the user can have
 * their profile viewed as they would like"; the record stays).
 *   GET → { rounds, posts } — the caller's results hidden from their profile.
 *   PATCH { kind: 'post' | 'golf_round', id, hidden } → hide or show one.
 *     The owner, or their guardian (the post matrix's 'write_content').
 * Nothing here removes a result — setResultHidden never touches the handicap
 * or the dataset.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const Body = z.object({ kind: z.enum(['post', 'golf_round']), id: z.string().regex(UUID_RE), hidden: z.boolean() });

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const list = await readHiddenResults(getSupabaseAdmin(), user.id);
    return NextResponse.json(list, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/results/visibility]', error);
    return NextResponse.json({ error: 'Could not load your hidden results' }, { status: 500, headers: NO_STORE });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'result-visibility', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const { kind, id, hidden } = parsed.data;
    const admin = getSupabaseAdmin();
    const { data } = await admin.from(kind === 'post' ? 'posts' : 'golf_rounds').select('profile_id').eq('id', id).maybeSingle();
    const owner = (data as { profile_id: string } | null)?.profile_id;
    if (!owner) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const allowed = owner === user.id || resolveProfileAction(await getProfileRole(user.id, owner), 'write_content');
    if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const out = await setResultHidden(admin, { kind, id }, hidden, owner);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: out.status, headers: NO_STORE });
    return NextResponse.json(out, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[PATCH /api/results/visibility]', error);
    return NextResponse.json({ error: 'Could not update it' }, { status: 500, headers: NO_STORE });
  }
}
