/**
 * The acting profile for a sport-events write (Events program, PR 4): the
 * session user, or — through resolveActingProfile, THE acting-as gate — a
 * supervised athlete their guardian acts for (`profile_id` in the body,
 * `?as=` on a GET). A supervised profile MAY host and play (Tom); the
 * event rows carry `created_by_user_id` for the author.
 */
import { NextResponse } from 'next/server';
import { resolveActingProfile } from '@/lib/guardian-gate';

export type Actor = { ok: true; profileId: string; actingAs: boolean } | { ok: false; response: NextResponse };

export async function resolveActor(userId: string, requested: unknown, roleError = 'Not authorized to act for this profile'): Promise<Actor> {
  const target = typeof requested === 'string' && requested.length > 0 ? requested : null;
  const gate = await resolveActingProfile(userId, target, roleError);
  if (!gate.ok) return { ok: false, response: NextResponse.json({ error: gate.error }, { status: gate.status }) };
  return { ok: true, profileId: gate.actorId, actingAs: gate.actingAs };
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function bodyProfileId(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const v = (body as Record<string, unknown>).profile_id;
  return typeof v === 'string' ? v : null;
}
