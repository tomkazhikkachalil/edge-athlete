import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { isActivityType } from '@/lib/activities/catalog';
import { parseFit } from '@/lib/activities/parse-fit-server';
import { importActivity } from '@/lib/activities/write-server';
import { ActivityParseError } from '@/lib/activities/xml-scan';

/**
 * POST /api/activities/fit — import one .FIT activity (Activities, 245).
 *
 * The raw file is decoded HERE, never in the browser: Garmin's FIT SDK is
 * licensed as Garmin's confidential information, not to be made available
 * to third parties (parse-fit-server.ts). A FIT is compact binary — a long
 * ride is a few hundred KB — so the whole file fits the request cap.
 *
 * multipart/form-data: file (≤ 4 MB, starts with a FIT header), tz (the
 * uploader's IANA zone, for the local date when the file has no offset),
 * type (optional — the athlete's pick overrides the file's sport),
 * targetProfileId (a guardian importing for their athlete).
 */
export const maxDuration = 30;

const MAX_FIT_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'activity-import', { userId: user.id });
    if (limited) return limited;

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return NextResponse.json({ error: 'Invalid upload' }, { status: 400 });
    }
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (file.size > MAX_FIT_BYTES) {
      return NextResponse.json({ error: 'This FIT file is larger than 4 MB — that is not an activity file.' }, { status: 413 });
    }

    const rawTarget = form.get('targetProfileId');
    const gate = await resolveActingProfile(
      user.id,
      typeof rawTarget === 'string' && rawTarget ? rawTarget : null,
      'Only a guardian may import activities for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    let activity;
    try {
      activity = parseFit(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      if (e instanceof ActivityParseError) return NextResponse.json({ error: e.message }, { status: 422 }); // hardening-ok: ActivityParseError messages are written for the athlete (xml-scan.ts)
      console.error('[activities/fit] decode failed:', e instanceof Error ? e.message : e);
      return NextResponse.json({ error: 'This FIT file could not be read.' }, { status: 422 });
    }
    const type = form.get('type');
    if (isActivityType(type)) activity = { ...activity, type };
    const tz = form.get('tz');

    const outcome = await importActivity(getSupabaseAdmin(), gate.actorId, activity, {
      timeZone: typeof tz === 'string' && tz.length <= 64 ? tz : null,
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    return NextResponse.json({ id: outcome.id, duplicate: outcome.duplicate }, { status: outcome.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/fit] import error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
