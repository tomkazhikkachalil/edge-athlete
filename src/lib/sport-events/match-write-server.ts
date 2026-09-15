/**
 * The three intent writes' common preamble (Events program, phase 3, PR 6):
 * auth, the rate bucket, the actor, the event gate, the match by id, the
 * live-round rule — then the route does its one thing and answers the
 * recomputed match. Server-only; the routes are plain sequencing.
 */
import { NextRequest, NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UUID_RE } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { readSportEventAccess } from './access-server';
import { bodyProfileId, readJson, resolveActor } from './actor-server';
import { MATCH_REFUSAL_COPY } from './match';
import { readMatchContext, type RoundMatch } from './match-server';
import { projectMatch, sideOfViewer, type MatchView } from './match-view';
import { ROUND_COLUMNS } from './rounds-server';
import type { SportEventRoundRow, SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface MatchWriteContext {
  admin: Admin;
  event: SportEventRow;
  round: SportEventRoundRow;
  match: RoundMatch;
  body: Record<string, unknown>;
  actorProfileId: string;
  canManage: boolean;
  /** The side the actor plays in THIS match, or null. */
  mySide: 1 | 2 | null;
  /** The version the body carries. */
  version: number;
}

export const refuse = (reason: keyof typeof MATCH_REFUSAL_COPY, status: 400 | 403 | 409 = 400) => NextResponse.json({ error: MATCH_REFUSAL_COPY[reason], reason }, { status });

export async function openMatchWrite(request: NextRequest, params: Promise<{ id: string; mid: string }>): Promise<{ ok: true; ctx: MatchWriteContext } | { ok: false; response: NextResponse }> {
  const { id, mid } = await params;
  if (!UUID_RE.test(id) || !UUID_RE.test(mid)) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) };
  const { user, error: authError } = await getServerAuth(request);
  if (authError || !user) return { ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) };
  const limited = await enforceRateLimit(request, 'sport-event', { userId: user.id });
  if (limited) return { ok: false, response: limited };
  const raw = await readJson(request);
  const body = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const actor = await resolveActor(user.id, bodyProfileId(raw));
  if (!actor.ok) return { ok: false, response: actor.response };
  const admin = getSupabaseAdmin();
  const read = await readSportEventAccess(admin, id, actor.profileId, null);
  if (!read) return { ok: false, response: NextResponse.json({ error: 'Event not found' }, { status: 404 }) };
  const ctx = await readMatchContext(admin, read.event, mid, ROUND_COLUMNS);
  if (!ctx) return { ok: false, response: NextResponse.json({ error: 'Match not found' }, { status: 404 }) };
  const version = body.version;
  if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) return { ok: false, response: NextResponse.json({ error: 'version must be the match version you last read' }, { status: 400 }) };
  const view = projectMatch(ctx.match);
  const mySide = sideOfViewer(view, actor.profileId);
  // A member of the match or an organizer; a stranger who can view the event gets the same 403 as a follower.
  if (!read.access.canManage && mySide === null) return { ok: false, response: NextResponse.json({ error: 'Only a player in this match, or an organizer, can change it.' }, { status: 403 }) };
  if (ctx.round.status !== 'live') return { ok: false, response: refuse('round_not_live', 409) };
  return { ok: true, ctx: { admin, event: read.event, round: ctx.round, match: ctx.match, body, actorProfileId: actor.profileId, canManage: read.access.canManage, mySide, version } };
}

/** Re-read the match after a write and answer it (the client replaces its copy). */
export async function answerMatch(ctx: Pick<MatchWriteContext, 'admin' | 'event' | 'match'>): Promise<NextResponse> {
  const next = await readMatchContext(ctx.admin, ctx.event, ctx.match.id, ROUND_COLUMNS);
  const match: MatchView | null = next ? projectMatch(next.match) : null;
  return NextResponse.json({ match }, { headers: { 'Cache-Control': 'private, no-store' } });
}
