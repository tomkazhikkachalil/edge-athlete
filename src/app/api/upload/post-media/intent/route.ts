import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { checkUploadIntent } from '@/lib/media/upload-rules';
import { signIncomingUpload } from '@/lib/media/upload-server';
import { reportRouteError } from '@/lib/observability/report';

// ── POST /api/upload/post-media/intent ───────────────────────────────────────
// Step 1 of the direct upload (src/lib/media/upload-rules.ts): the same gates
// the old FormData door ran — the write gate, the 'upload' bucket, the
// acting-as gate, the allowlist and the cap — then a one-time signed URL for
// a key the SERVER minted. The bytes never pass through this function, so
// Vercel's 4.5 MB request cap no longer decides what a phone can post.
export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const targetProfileId =
      typeof body.targetProfileId === 'string' && body.targetProfileId ? body.targetProfileId : null;
    const gate = await resolveActingProfile(
      user.id,
      targetProfileId,
      'Only a guardian may upload media for this profile.'
    );
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });

    const check = checkUploadIntent(body.type, body.size);
    if (!check.ok) return NextResponse.json({ error: check.error }, { status: check.status });

    const signed = await signIncomingUpload(getSupabaseAdmin(), gate.actorId, check.type);
    return NextResponse.json(signed, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('Upload intent error:', error);
    return NextResponse.json({ error: 'Failed to start the upload' }, { status: 500 });
  }
}
