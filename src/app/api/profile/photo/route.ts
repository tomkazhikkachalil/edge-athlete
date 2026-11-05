import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireActiveWriter } from '@/lib/auth-server';
import { resolveActingProfile } from '@/lib/guardian-gate';
import { enforceRateLimit } from '@/lib/rate-limit';
import { finalizeIncomingUpload } from '@/lib/media/upload-server';
import { reportRouteError } from '@/lib/observability/report';
import { revalidatePublicHead } from '@/lib/profiles/public-head';
import { COVER_BUCKET, PROFILE_SOURCE_BUCKET, type ProfilePhotoSlot } from '@/lib/profiles/photo-paths';
import { profileSourcePath } from '@/lib/profiles/photo-recipe';
import { readPhotoJsonFields, storeProfilePhoto, type StoredSource } from '@/lib/profiles/photo-source-server';

/**
 * POST /api/profile/photo — a profile picture or cover by the DIRECT route
 * (Nov 2 2026; SCALE_AUDIT hole #9). The bytes never pass through a Vercel
 * function: the render, and the kept original when there is one, go
 * intent → a signed PUT → here as their incoming keys. This route finalizes
 * each (the owner check, the sniff, the metadata strip — upload-server.ts)
 * to the slot's MANAGED path (avatars/…, covers/<id>/…, profile-sources/…
 * — photo-paths.ts keeps recognising what is ours), then writes the row
 * through the one writer, storeProfilePhoto. The answer is the old routes'
 * ({ success, <slot>_url, <slot>_source_url, <slot>_recipe }).
 * Body: { slot, path, sourcePath?, sameSource?, recipe?, targetProfileId? }.
 */
const SLOTS: ReadonlySet<string> = new Set(['avatar', 'cover']);
const MANAGED_BUCKET = COVER_BUCKET; // 'uploads' — in AVATAR_BUCKETS too, so both slots' cleanup rules apply

export async function POST(request: NextRequest) {
  try {
    const user = await requireActiveWriter(request, { limit: 'upload' }); // 286
    const limited = await enforceRateLimit(request, 'upload', { userId: user.id });
    if (limited) return limited;

    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    const slot = typeof body.slot === 'string' && SLOTS.has(body.slot) ? (body.slot as ProfilePhotoSlot) : null;
    if (!slot) return NextResponse.json({ error: 'slot must be avatar or cover' }, { status: 400 });
    if (typeof body.path !== 'string' || !body.path) return NextResponse.json({ error: 'path is required' }, { status: 400 });
    const fields = readPhotoJsonFields(body);
    if (!fields.ok) return NextResponse.json({ error: fields.error }, { status: 400 });
    const sourcePath = typeof body.sourcePath === 'string' && body.sourcePath ? body.sourcePath : null;
    if (fields.sameSource && sourcePath) return NextResponse.json({ error: 'sameSource and a new source cannot both be sent' }, { status: 400 });

    const targetProfileId = typeof body.targetProfileId === 'string' && body.targetProfileId ? body.targetProfileId : null;
    const gate = await resolveActingProfile(user.id, targetProfileId, 'You do not have permission to change this profile');
    if (!gate.ok) return NextResponse.json({ error: gate.error }, { status: gate.status });
    const profileId = gate.actorId;
    const admin = getSupabaseAdmin();
    const now = Date.now();

    // The render → the slot's managed path.
    const render = await finalizeIncomingUpload(admin, profileId, body.path, {
      targetKey: (id, ext) => (slot === 'avatar' ? `avatars/avatar-${profileId}-${now}.${ext}` : `covers/${profileId}/${now}.${ext}`),
    });
    if (!render.ok) {
      const status = render.status === 400 && render.error === 'Unknown upload' ? 403 : render.status;
      return NextResponse.json({ error: render.error }, { status });
    }
    if (render.type !== 'image') {
      await admin.storage.from(render.bucket).remove([render.path]).catch(() => undefined);
      return NextResponse.json({ error: 'A profile photo must be an image' }, { status: 400 });
    }

    // The kept original → profile-sources/…
    let source: StoredSource | null = null;
    if (sourcePath) {
      const kept = await finalizeIncomingUpload(admin, profileId, sourcePath, {
        targetKey: (_id, ext) => profileSourcePath(profileId, slot, now, ext),
      });
      if (!kept.ok || kept.type !== 'image') {
        await admin.storage.from(render.bucket).remove([render.path]).catch(() => undefined);
        if (kept.ok) await admin.storage.from(kept.bucket).remove([kept.path]).catch(() => undefined);
        const status = !kept.ok && kept.status === 400 && kept.error === 'Unknown upload' ? 403 : kept.ok ? 400 : kept.status;
        return NextResponse.json({ error: kept.ok ? 'The original must be an image' : kept.error }, { status });
      }
      source = { path: kept.path, url: kept.url };
      if (kept.bucket !== PROFILE_SOURCE_BUCKET) reportRouteError('profile photo: the original landed outside the source bucket', kept.bucket);
    }

    const { data: current } = await admin
      .from('profiles')
      .select(`${slot}_url, ${slot}_source_url, handle`)
      .eq('id', profileId)
      .maybeSingle();
    const row = (current ?? {}) as Record<string, unknown>;

    const stored = await storeProfilePhoto(admin, {
      profileId,
      slot,
      derived: { bucket: MANAGED_BUCKET, path: render.path, url: render.url },
      fields: { source, recipe: fields.recipe, sameSource: fields.sameSource },
      previous: { url: (row[`${slot}_url`] as string | null) ?? null, sourceUrl: (row[`${slot}_source_url`] as string | null) ?? null },
      now,
    });
    if (!stored.ok) {
      if (stored.status === 500) reportRouteError('profile photo: row update error:', stored.detail ?? stored.error);
      return NextResponse.json({ error: stored.error }, { status: stored.status });
    }
    if (slot === 'avatar') revalidatePublicHead((row.handle as string | null) ?? null);

    return NextResponse.json(
      { success: true, [`${slot}_url`]: render.url, [`${slot}_source_url`]: stored.sourceUrl, [`${slot}_recipe`]: stored.recipe },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('profile photo error:', error);
    return NextResponse.json({ error: 'Failed to save the photo' }, { status: 500 });
  }
}
