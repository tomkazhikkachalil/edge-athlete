import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getServerAuth, getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { isUuid } from '@/lib/uuid';
import { reportRouteError } from '@/lib/observability/report';
import { ACTIVITY_TYPES } from '@/lib/activities/catalog';
import { readActivityForViewer, readStream } from '@/lib/activities/read-server';
import { ACTIVITY_COLUMNS, projectActivity, projectActivityDetail } from '@/lib/activities/visibility';
import { deleteActivity } from '@/lib/activities/write-server';

/**
 * /api/activities/[id] — one activity (Activities, 245).
 *
 * GET: the page's read. The gate is read-server.ts resolveActivityAccess
 * (self / guardian → owner; departed, blocked, "Only me" or a private
 * profile → the same 404 as not-found); the projection decides what comes
 * back (a viewer's route is trimmed, a supervised athlete's viewers get no
 * position). Viewer-dependent → `private, no-store`. Signed-out viewers of
 * a public athlete are welcome.
 *
 * PATCH { name?, type?, onlyMe? } and DELETE: the owner audience only (the
 * athlete or their guardian). DELETE removes the stream and the feed post
 * too — the page's confirm says so.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' };
const notFound = () => NextResponse.json({ error: 'Activity not found' }, { status: 404, headers: NO_STORE });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const { user } = await getServerAuth(request);
    const admin = getSupabaseAdmin();
    const read = await readActivityForViewer(admin, user?.id ?? null, id);
    if (!read.ok) return notFound();
    const [stream, athleteRes] = await Promise.all([
      readStream(admin, read.row.stream_path),
      admin.from('profiles').select('id, full_name, first_name, last_name, handle').eq('id', read.row.profile_id).maybeSingle(),
    ]);
    // The viewer may see this profile (the gate said so), so its own name and
    // handle are what its profile page already shows them.
    const p = athleteRes.data;
    const athlete = p
      ? { id: p.id as string, name: (p.full_name as string | null) || [p.first_name, p.last_name].filter(Boolean).join(' ') || 'Athlete', handle: (p.handle as string | null) ?? null }
      : null;
    return NextResponse.json({ activity: projectActivityDetail(read.row, stream, read.audience), athlete }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]] GET error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

const PatchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    type: z.enum(ACTIVITY_TYPES).optional(),
    onlyMe: z.boolean().optional(),
  })
  .strict();

export async function PATCH(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const read = await readActivityForViewer(admin, user.id, id);
    if (!read.ok || read.audience !== 'owner') return notFound();

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const parsed = PatchSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'Invalid changes' }, { status: 400 });
    const { name, type, onlyMe } = parsed.data;
    if (onlyMe === true && read.row.post_id) {
      return NextResponse.json(
        { error: 'This activity is on your feed. Delete that post first, then set the activity to Only me.' },
        { status: 409 }
      );
    }
    const patch: Record<string, unknown> = {};
    if (name !== undefined) patch.name = name;
    if (type !== undefined) patch.activity_type = type;
    if (onlyMe !== undefined) patch.only_me = onlyMe;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ activity: projectActivity(read.row, 'owner') }, { headers: NO_STORE });
    }
    const { data, error } = await admin
      .from('activities')
      .update(patch)
      .eq('id', id)
      .eq('profile_id', read.row.profile_id)
      .select(ACTIVITY_COLUMNS)
      .single();
    if (error || !data) {
      console.error('[activities/[id]] update failed:', error?.message);
      return NextResponse.json({ error: 'Could not save your changes.' }, { status: 500 });
    }
    return NextResponse.json({ activity: projectActivity(data as unknown as typeof read.row, 'owner') }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]] PATCH error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    if (!isUuid(id)) return notFound();
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const read = await readActivityForViewer(admin, user.id, id);
    if (!read.ok || read.audience !== 'owner') return notFound();
    const out = await deleteActivity(admin, read.row);
    if (!out.ok) return NextResponse.json({ error: out.error }, { status: 500 });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/[id]] DELETE error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
