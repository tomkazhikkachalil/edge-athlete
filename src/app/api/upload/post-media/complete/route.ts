import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { finalizeIncomingUpload } from '@/lib/media/upload-server';
import { reportRouteError } from '@/lib/observability/report';

// The metadata scrub re-muxes a video of up to the cap in memory — the old
// door's headroom.
export const maxDuration = 120;

// ── POST /api/upload/post-media/complete ─────────────────────────────────────
// Step 3 of the direct upload: the gates run again (a key is only ever
// finalized by the owner it was minted for), the stored object's real size
// and type are checked, a video is scrubbed, and the file lands at
// posts/<owner>/… . The answer is the old door's { url, type, scrubbed }, so
// every caller and reader is unchanged.
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const body = await request.json().catch(() => ({}));
    const targetProfileId =
      typeof body.targetProfileId === 'string' && body.targetProfileId ? body.targetProfileId : null;
    const gate = await resolveActingProfile(
      user.id,
      targetProfileId,
      'Only a guardian may upload media for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const result = await finalizeIncomingUpload(getSupabaseAdmin(), gate.actorId, body.path);
    if (!result.ok) {
      // A path that is not this owner's reads as forbidden, never as "missing".
      const status = result.status === 400 && result.error === 'Unknown upload' ? 403 : result.status;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(
      { url: result.url, type: result.type, scrubbed: result.scrubbed },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Upload complete error:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
