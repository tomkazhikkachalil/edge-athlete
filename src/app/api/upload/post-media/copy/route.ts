import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';

// ── POST /api/upload/post-media/copy ─────────────────────────────────────────
// The batch upload's multi-assign (Wave 5 "household media library"): one
// picked file, several siblings' posts. Bytes are COPIED server-side to a
// fresh object under each target athlete's prefix — never a shared object
// (hardDeleteAccount and the upload DELETE remove objects without
// cross-reference checks, so a shared object under sibling A would break
// sibling B's post when A leaves; the storage×2 is the cheap side of that
// trade, per the mig-120 no-aliasing doctrine). One small JSON round-trip
// instead of re-uploading up to 50MB×3 per extra athlete over cellular.
//
// Consumes an 'upload' rate token — each copy creates a storage object, so
// it spends the same budget an upload would, honestly.

const IMAGE_EXTS = new Set(['jpg', 'png', 'gif', 'webp']);
const VIDEO_EXTS = new Set(['mp4', 'mov', 'webm']);

export async function POST(request: NextRequest) {
  try {
    const supabase = getSupabaseAdmin();
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const body = await request.json().catch(() => ({}));
    const sourceUrl = typeof body.sourceUrl === 'string' ? body.sourceUrl : '';
    const targetProfileId =
      typeof body.targetProfileId === 'string' && body.targetProfileId ? body.targetProfileId : null;

    // Source must be an uploads-bucket posts/ object.
    const publicPrefix = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/uploads/`;
    const sourcePath = sourceUrl.startsWith(publicPrefix)
      ? sourceUrl.slice(publicPrefix.length)
      : sourceUrl.startsWith('posts/')
      ? sourceUrl
      : null;
    const match = sourcePath?.match(/^posts\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.([a-z0-9]+)$/);
    if (!sourcePath || !match || !isUuid(match[1])) {
      return NextResponse.json({ error: 'Invalid source media URL' }, { status: 400 });
    }
    const [, sourceOwnerId, ext] = match;
    if (!IMAGE_EXTS.has(ext) && !VIDEO_EXTS.has(ext)) {
      return NextResponse.json({ error: 'Invalid source media URL' }, { status: 400 });
    }

    // The caller must be entitled to BOTH sides: the source bytes (their own
    // upload, or an athlete they guard) and the target athlete's prefix.
    // Same gate as the upload/content routes — copy semantics can never
    // exceed upload semantics.
    const sourceGate = await resolveActingProfile(
      user.id,
      sourceOwnerId === user.id ? null : sourceOwnerId,
      'Only a guardian may copy media from this profile.'
    );
    if (!sourceGate.ok) {
      return NextResponse.json({ error: sourceGate.error }, { status: sourceGate.status });
    }
    const targetGate = await resolveActingProfile(
      user.id,
      targetProfileId,
      'Only a guardian may copy media to this profile.'
    );
    if (!targetGate.ok) {
      return NextResponse.json({ error: targetGate.error }, { status: targetGate.status });
    }

    const destPath = `posts/${targetGate.actorId}/${crypto.randomUUID()}.${ext}`;
    const { error: copyError } = await supabase.storage.from('uploads').copy(sourcePath, destPath);
    if (copyError) {
      console.error('[media-copy] storage copy failed:', copyError);
      return NextResponse.json({ error: 'Could not copy the media' }, { status: 500 });
    }
    const { data: urlData } = supabase.storage.from('uploads').getPublicUrl(destPath);
    if (!urlData?.publicUrl) {
      return NextResponse.json({ error: 'Could not copy the media' }, { status: 500 });
    }

    return NextResponse.json({
      url: urlData.publicUrl,
      type: IMAGE_EXTS.has(ext) ? 'image' : 'video',
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[media-copy] error:', error);
    return NextResponse.json({ error: 'Could not copy the media' }, { status: 500 });
  }
}
