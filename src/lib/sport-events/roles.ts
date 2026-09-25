// ── Event roles — who can run an event (Authority PR 2, Sep 25 2026) ─────────
// Tom: every event needs a BACKUP — a second person able to run it. The
// backup is an accepted co-organizer. Pure and node-testable; the server
// (roles-server.ts) applies a plan, host-transfer-server.ts moves the host.
//
//   make_co_organizer — the HOST promotes an accepted player (or follower) to
//                       co-organizer. A co-organizer does not mint peers (the
//                       org rule: managers never create managers).
//   make_participant  — the HOST returns a co-organizer to a plain player.
//   step_down         — a co-organizer returns THEMSELF to a plain player.
//   make_host         — the HOST hands the event to an accepted co-organizer;
//                       the old host stays on as a co-organizer.

import type { SportEventParticipantStatus, SportEventRole, SportEventStatus } from './types';

export const ROLE_ACTIONS = ['make_co_organizer', 'make_participant', 'step_down', 'make_host'] as const;
export type RoleAction = (typeof ROLE_ACTIONS)[number];

export function isRoleAction(v: unknown): v is RoleAction {
  return typeof v === 'string' && (ROLE_ACTIONS as readonly string[]).includes(v);
}

export interface RoleChangeContext {
  eventStatus: SportEventStatus;
  /** The actor is the event's host. */
  actorIsHost: boolean;
  /** The actor is the target row's person. */
  actorIsTarget: boolean;
  /** The target row. */
  target: { role: SportEventRole; status: SportEventParticipantStatus; playing: boolean };
  /** The target holds authority (not limited / suspended / banned, not departed). */
  targetHoldsAuthority: boolean;
}

export type RolePlan =
  | { ok: true; kind: 'row'; next: { role: SportEventRole; playing?: boolean } }
  | { ok: true; kind: 'host' }
  | { ok: false; status: 403 | 409; error: string };

export function planRoleChange(action: RoleAction, ctx: RoleChangeContext): RolePlan {
  const { target } = ctx;
  if (ctx.eventStatus === 'cancelled') return { ok: false, status: 409, error: 'This event was cancelled.' };
  switch (action) {
    case 'make_co_organizer': {
      if (!ctx.actorIsHost) return { ok: false, status: 403, error: 'Only the host can add a co-organizer.' };
      if (target.role === 'organizer') return { ok: false, status: 409, error: 'That is the host.' };
      if (target.role === 'co_organizer') return { ok: false, status: 409, error: 'Already a co-organizer.' };
      if (target.status !== 'accepted') return { ok: false, status: 409, error: 'Only someone who has joined can be a co-organizer.' };
      if (!ctx.targetHoldsAuthority) return { ok: false, status: 409, error: 'That account cannot run events right now.' };
      // A follower who becomes a co-organizer organizes without playing (the follower CHECK).
      return { ok: true, kind: 'row', next: target.role === 'follower' ? { role: 'co_organizer', playing: false } : { role: 'co_organizer' } };
    }
    case 'make_participant': {
      if (!ctx.actorIsHost) return { ok: false, status: 403, error: 'Only the host can change a co-organizer.' };
      if (target.role !== 'co_organizer') return { ok: false, status: 409, error: 'Not a co-organizer.' };
      return { ok: true, kind: 'row', next: { role: 'participant' } };
    }
    case 'step_down': {
      if (!ctx.actorIsTarget) return { ok: false, status: 403, error: 'You can only step down yourself.' };
      if (target.role !== 'co_organizer') return { ok: false, status: 409, error: target.role === 'organizer' ? 'The host hands the event to a co-organizer instead.' : 'Not a co-organizer.' };
      return { ok: true, kind: 'row', next: { role: 'participant' } };
    }
    case 'make_host': {
      if (!ctx.actorIsHost) return { ok: false, status: 403, error: 'Only the host can hand the event over.' };
      if (target.role !== 'co_organizer' || target.status !== 'accepted') return { ok: false, status: 409, error: 'Hand the event to an accepted co-organizer.' };
      if (!ctx.targetHoldsAuthority) return { ok: false, status: 409, error: 'That account cannot run events right now.' };
      return { ok: true, kind: 'host' };
    }
    default:
      return { ok: false, status: 409, error: 'Unknown action.' };
  }
}
