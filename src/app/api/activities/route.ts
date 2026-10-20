import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { fromWire } from '@/lib/activities/wire';
import { parseWireActivity } from '@/lib/activities/wire-schema';
import { parseFinishAnswers } from '@/lib/activities/details-schema';
import { applyFinishAnswers, importActivity } from '@/lib/activities/write-server';

/**
 * POST /api/activities — save the phone recorder's finished recording
 * (Live Activities, 251). `onlyMe: true` (the recorder's review) saves it
 * Only me in the same call.
 *
 * The phone sends the compact columnar payload (wire.ts, ≤ 10,000 samples,
 * `format: 'live'` — the only format since Oct 13 2026, when the .GPX /
 * .TCX file import left with the Import Activity door; a .FIT route left
 * with it). This route re-validates it (wire-schema.ts) and the writer
 * recomputes every total — nothing the client computed is trusted: source
 * 'live', external_id the recording's own id (a retry is a 200 duplicate,
 * never a second row), the segments it marked, and a step estimate from the
 * acting profile's height.
 *
 * Body: { activity: WireActivity, targetProfileId?: string, onlyMe?: true,
 * finish?: { effort?, notes?, details? } } — the Finish's answers (Oct 16
 * 2026, details.ts): validated for the recording's type BEFORE anything is
 * written, then applied to the row (a retry applies them again).
 * — a guardian saves for their athlete through the shared acting gate.
 * 201 { id, duplicate: false } · 200 { id, duplicate: true } · 400 / 413 /
 * 422 with the reason.
 */
const MAX_BODY_BYTES = 3_000_000;

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'activity-import', { userId: user.id });
    if (limited) return limited;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'This activity is too large to save.' }, { status: 413 });
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { activity, targetProfileId, finish } = (body ?? {}) as { activity?: unknown; targetProfileId?: unknown; finish?: unknown };

    const gate = await resolveActingProfile(
      user.id,
      typeof targetProfileId === 'string' && targetProfileId ? targetProfileId : null,
      'Only a guardian may save activities for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const parsed = parseWireActivity(activity);
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
    const answers = parseFinishAnswers(parsed.value.type, finish);
    if (!answers.ok) return NextResponse.json({ error: answers.error }, { status: 400 });
    // A9: a sport session IS its sport — never saved without one.
    if (parsed.value.type === 'sport_session' && !answers.value.sportKey) return NextResponse.json({ error: 'Choose the sport for this session.' }, { status: 400 });

    const admin = getSupabaseAdmin();
    const { data: prof } = await admin.from('profiles').select('height_cm').eq('id', gate.actorId).maybeSingle();
    const heightCm = typeof prof?.height_cm === 'number' ? prof.height_cm : null;
    const outcome = await importActivity(admin, gate.actorId, fromWire(parsed.value), {
      timeZone: parsed.value.tz,
      heightCm,
      source: 'live',
      externalId: `live:${parsed.value.recordingId}`,
      live: { segments: parsed.value.segments ?? [] },
    });
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status });
    const applied = await applyFinishAnswers(admin, gate.actorId, outcome.id, answers.value);
    if (!applied.ok) return NextResponse.json({ error: applied.error }, { status: 500 });
    // 269 (Oct 19 2026, Tom: "Only me" is dropped): nothing at save decides
    // the profile — every finished activity stands in Training per the
    // account's privacy. The feed is the client's next call (a post row);
    // hiding is the owner's later PATCH { onlyMe } on the activity page.
    return NextResponse.json({ id: outcome.id, duplicate: outcome.duplicate }, { status: outcome.duplicate ? 200 : 201 });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities] save error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
