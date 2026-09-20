import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody, uuid } from '@/lib/validation';
import { applyMute, listMutes, removeMute } from '@/lib/mutes';

/**
 * /api/mutes — the user-level mute (Support & Reporting, Spec 2; mig 223).
 * Silent and one-directional: the muted person's posts, comments and
 * activity leave the caller's view; nobody is told. A limited account may
 * still mute (it is a read-side preference, not contact).
 *
 *   GET → { supported, mutedIds }   POST { profileId }   DELETE { profileId }
 */
const Body = z.object({ profileId: uuid });
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function GET(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    return NextResponse.json(await listMutes(getSupabaseAdmin(), user.id), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GET /api/mutes]', error);
    return NextResponse.json({ error: 'Could not load mutes' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'mute', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    if (parsed.data.profileId === user.id) return NextResponse.json({ error: 'You cannot mute yourself.' }, { status: 400, headers: NO_STORE });
    const result = await applyMute(getSupabaseAdmin(), user.id, parsed.data.profileId);
    if (result.notLive) return NextResponse.json({ error: 'Mute is not available yet.' }, { status: 503, headers: NO_STORE });
    if (!result.ok) return NextResponse.json({ error: 'Could not mute' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[POST /api/mutes]', error);
    return NextResponse.json({ error: 'Could not mute' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const result = await removeMute(getSupabaseAdmin(), user.id, parsed.data.profileId);
    if (!result.ok) return NextResponse.json({ error: 'Could not unmute' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[DELETE /api/mutes]', error);
    return NextResponse.json({ error: 'Could not unmute' }, { status: 500, headers: NO_STORE });
  }
}
