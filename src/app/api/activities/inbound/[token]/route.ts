import { NextRequest, NextResponse } from 'next/server';
import { activeWriterRefusal, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';
import { isValidTimeZone } from '@/lib/calendar/time-zones';
import { findUploadLink, isSupervisedProfile, recordDelivery } from '@/lib/activities/connections-server';
import { MAX_INBOUND_BYTES, readInbound } from '@/lib/activities/inbound-server';
import { importActivity } from '@/lib/activities/write-server';

/**
 * POST /api/activities/inbound/[token] — the personal upload link (fix round
 * part 3, PR 3). The Apple Watch path: a bridge app on the athlete's iPhone
 * POSTs each workout here; a Shortcut or a script may POST the file a watch
 * exports instead.
 *
 * NO SESSION, by design — the phone's automation has none. The TOKEN is the
 * authorization: 256 random bits, stored as a sha256 (connections-server.ts),
 * shown once in Settings, replaced or removed there. An unknown, replaced or
 * malformed token is one 404. On top of the token:
 *   • a supervised profile is refused (and so is a link minted before the
 *     account became supervised) — the same 404;
 *   • a limited / suspended / banned account is refused by the write gate;
 *   • two buckets: per IP (before the lookup) and per link (after it);
 *   • every activity goes through the ONE writer — the server recomputes the
 *     totals, refuses the implausible, trims a viewer's route — as
 *     `source: 'upload_link'`, deduped against what the athlete already has.
 *
 * Body: the bridge app's workout JSON, or a raw .fit / .gpx / .tcx (also as
 * the first file of a multipart form). `?tz=` (set when the link was made)
 * places a file with no offset of its own on the right local day.
 *
 * 200 { received, imported, duplicates, refused, skipped } whenever the body
 * was READ — a bridge app retries a non-2xx, and an implausible workout will
 * not get better on a retry. 413 / 415 / 422 when the body itself is not
 * something this link takes.
 */
export const maxDuration = 60;

const notFound = () => NextResponse.json({ error: 'This upload link is not active.' }, { status: 404 });

type Ctx = { params: Promise<{ token: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  try {
    const limitedIp = await enforceRateLimit(request, 'activity-inbound');
    if (limitedIp) return limitedIp;

    const { token } = await params;
    const admin = getSupabaseAdmin();
    const link = await findUploadLink(admin, token);
    if (!link) return notFound();

    const limitedLink = await enforceRateLimit(request, 'activity-inbound-link', { userId: link.id });
    if (limitedLink) return limitedLink;

    if (await isSupervisedProfile(admin, link.profileId)) return notFound();
    const refusal = await activeWriterRefusal(link.profileId);
    if (refusal) return refusal;

    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_INBOUND_BYTES) {
      return NextResponse.json({ error: 'This delivery is larger than 4 MB. Send fewer workouts at a time.' }, { status: 413 });
    }

    let bytes: Uint8Array;
    if ((request.headers.get('content-type') ?? '').toLowerCase().startsWith('multipart/form-data')) {
      let file: File | null = null;
      try {
        const form = await request.formData();
        for (const value of form.values()) {
          if (value instanceof File) { file = value; break; }
        }
      } catch {
        file = null;
      }
      if (!file) return NextResponse.json({ error: 'No file in this upload.' }, { status: 415 });
      bytes = new Uint8Array(await file.arrayBuffer());
    } else {
      bytes = new Uint8Array(await request.arrayBuffer());
    }
    if (bytes.length > MAX_INBOUND_BYTES) {
      return NextResponse.json({ error: 'This delivery is larger than 4 MB. Send fewer workouts at a time.' }, { status: 413 });
    }

    const read = readInbound(bytes);
    if (!read.ok) {
      await recordDelivery(admin, link.id, { ok: false, error: read.error });
      return NextResponse.json({ error: read.error }, { status: read.status });
    }

    const tzParam = new URL(request.url).searchParams.get('tz');
    const timeZone = tzParam && tzParam.length <= 64 && isValidTimeZone(tzParam) ? tzParam : null;

    let imported = 0;
    let duplicates = 0;
    const refused: string[] = [];
    for (const item of read.items) {
      const outcome = await importActivity(admin, link.profileId, item.activity, {
        timeZone,
        source: 'upload_link',
        externalId: item.externalId,
      });
      if (!outcome.ok) refused.push(outcome.error);
      else if (outcome.duplicate) duplicates++;
      else imported++;
    }

    // A delivery that was read is a sync, even an empty one ("nothing new").
    await recordDelivery(admin, link.id, { ok: true });
    return NextResponse.json({ received: read.items.length, imported, duplicates, refused, skipped: read.skipped });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[activities/inbound] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
