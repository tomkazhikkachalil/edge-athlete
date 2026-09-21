import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/tickets/attachment — a screenshot for a support request
 * (Support & Reporting, Spec 3). Multipart `file`, an IMAGE ≤ 5 MB, stored
 * in `uploads` under `{userId}/tickets/{uuid}.{ext}` — the caller then
 * files the ticket with `attachment_url`, and `POST /api/tickets`
 * re-asserts the path is under THIS user's `tickets/` prefix. Served back
 * through the media proxy's `ticket` entity (the submitter, their guardians,
 * a moderator). `tickets.attachment_url` is registered in
 * `URL_SOURCE_COLUMNS` in this same change — the weekly sweep would delete
 * an unregistered file. NOT behind the write gate on purpose: a limited
 * account must still be able to show support what it sees.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };

export async function POST(request: NextRequest) {
  const headers = { 'Cache-Control': 'private, no-store' } as const;
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'No file provided' }, { status: 400, headers });
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'The screenshot must be 5 MB or smaller.' }, { status: 400, headers });
    const ext = IMAGE_EXT[file.type];
    if (!ext) return NextResponse.json({ error: 'A screenshot must be a JPEG, PNG, WebP or GIF.' }, { status: 400, headers });

    const path = `${user.id}/tickets/${crypto.randomUUID()}.${ext}`;
    const admin = getSupabaseAdmin();
    const { error } = await admin.storage.from('uploads').upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, cacheControl: '3600', upsert: false });
    if (error) {
      reportRouteError('[POST /api/tickets/attachment] upload failed:', error.message);
      return NextResponse.json({ error: 'Could not upload the screenshot' }, { status: 500, headers });
    }
    const { data: { publicUrl } } = admin.storage.from('uploads').getPublicUrl(path);
    return NextResponse.json({ url: publicUrl, path }, { status: 201, headers });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/tickets/attachment]', error);
    return NextResponse.json({ error: 'Could not upload the screenshot' }, { status: 500, headers });
  }
}
