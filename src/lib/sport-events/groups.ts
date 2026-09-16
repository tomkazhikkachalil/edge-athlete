/**
 * Playing groups (Events program, PR 5) — pure. The organizer replaces a
 * round's whole plan in one PUT; this validates it against the roster:
 * every member is an accepted, playing participant of the event, nobody
 * is in two groups, positions and sequences are contiguous from 1.
 *
 * Phase 3 (212): on a MATCH format every member carries a `side` (1 | 2).
 * A member may arrive as a plain id (phase 1 / 2 bodies stay legal — the
 * side is then DERIVED from the position: singles 1 → side 1, 2 → side 2;
 * pairs 1–2 → side 1, 3–4 → side 2; anyone past that has no side and the
 * start refuses `groups_incomplete`) or as `{participant_id, side}`. On a
 * stroke format a `side` is a 400 by name. The size rules bite at START,
 * never here (MAX_GROUP_SIZE stays lenient so the organizer can arrange
 * incrementally).
 */
import type { MatchSides } from './types';

export type GroupMemberInput = string | { participant_id: string; side?: 1 | 2 | null };

export interface GroupInput {
  name?: string | null;
  tee_time?: string | null;
  starting_hole?: number;
  members: GroupMemberInput[];
}

export interface GroupRowPlan {
  sequence: number;
  name: string | null;
  tee_time: string | null;
  starting_hole: number;
  members: Array<{ participant_id: string; position: number; side: 1 | 2 | null }>;
}

export type GroupsPlan = { ok: true; value: GroupRowPlan[] } | { ok: false; error: string };

export const MAX_GROUPS = 60;
export const MAX_GROUP_SIZE = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The side a plain-id member gets from its 1-based position on a match format: singles 1 | 2; pairs 1–2 → 1, 3–4 → 2; else none. */
export function derivedSide(position: number, sides: MatchSides): 1 | 2 | null {
  const size = sides === 'singles' ? 1 : 2;
  if (position <= size) return 1;
  if (position <= 2 * size) return 2;
  return null;
}

const memberId = (m: GroupMemberInput): string | null => (typeof m === 'string' ? m : typeof m === 'object' && m !== null && typeof m.participant_id === 'string' ? m.participant_id : null);
const memberSide = (m: GroupMemberInput): 1 | 2 | null | undefined => (typeof m === 'string' ? undefined : m?.side ?? undefined);

/**
 * `sides` = the event's match shape, or null on a stroke format (a `side`
 * in the body is then refused by name).
 */
export function validateGroupsPlan(body: unknown, eligibleParticipantIds: ReadonlySet<string>, opts: { sides: MatchSides | null; game?: boolean } = { sides: null }): GroupsPlan {
  if (typeof body !== 'object' || body === null || !Array.isArray((body as { groups?: unknown }).groups)) return { ok: false, error: 'groups must be a list' };
  const groups = (body as { groups: unknown[] }).groups;
  if (groups.length > MAX_GROUPS) return { ok: false, error: `At most ${MAX_GROUPS} groups` };
  const seen = new Set<string>();
  const out: GroupRowPlan[] = [];
  groups.forEach((g, i) => {
    if (out.length !== i) return; // an earlier group already failed
    if (typeof g !== 'object' || g === null) return;
    const group = g as GroupInput;
    const name = typeof group.name === 'string' && group.name.trim() ? group.name.trim() : null;
    if (name !== null && name.length > 60) return;
    const teeTime = typeof group.tee_time === 'string' && group.tee_time && Number.isFinite(Date.parse(group.tee_time)) ? new Date(group.tee_time).toISOString() : null;
    const startingHole = group.starting_hole === undefined ? 1 : group.starting_hole;
    if (!Number.isInteger(startingHole) || startingHole < 1 || startingHole > 18) return;
    if (!Array.isArray(group.members) || group.members.length > MAX_GROUP_SIZE) return;
    const members: GroupRowPlan['members'] = [];
    for (const m of group.members) {
      const id = memberId(m);
      const side = memberSide(m);
      if (id === null || !UUID.test(id) || seen.has(id) || !eligibleParticipantIds.has(id)) return;
      if (side !== undefined && side !== null && side !== 1 && side !== 2) return;
      if (side !== undefined && side !== null && opts.sides === null && !opts.game) return;
      seen.add(id);
      const position = members.length + 1;
      // Phase 4: on a GAME a member's side is sent (1 | 2) or left open — never derived from the position (a side is any size).
      members.push({ participant_id: id, position, side: opts.sides !== null ? (side === undefined ? derivedSide(position, opts.sides) : side) : opts.game ? side ?? null : null });
    }
    out.push({ sequence: i + 1, name, tee_time: teeTime, starting_hole: startingHole, members });
  });
  if (out.length !== groups.length) {
    const i = out.length;
    const g = groups[i] as GroupInput | null;
    if (typeof g !== 'object' || g === null) return { ok: false, error: `Group ${i + 1} is not an object` };
    if (typeof g.name === 'string' && g.name.trim().length > 60) return { ok: false, error: `Group ${i + 1}: name is at most 60 characters` };
    if (g.starting_hole !== undefined && (!Number.isInteger(g.starting_hole) || g.starting_hole < 1 || g.starting_hole > 18)) return { ok: false, error: `Group ${i + 1}: starting_hole must be 1–18` };
    if (!Array.isArray(g.members)) return { ok: false, error: `Group ${i + 1}: members must be a list` };
    if (g.members.length > MAX_GROUP_SIZE) return { ok: false, error: `Group ${i + 1}: at most ${MAX_GROUP_SIZE} players` };
    for (const m of g.members) {
      const id = memberId(m);
      const side = memberSide(m);
      if (id === null || !UUID.test(id)) return { ok: false, error: `Group ${i + 1}: a member must be a participant id` };
      if (side !== undefined && side !== null && side !== 1 && side !== 2) return { ok: false, error: `Group ${i + 1}: side must be 1 or 2` };
      if (side !== undefined && side !== null && opts.sides === null && !opts.game) return { ok: false, error: `Group ${i + 1}: side is only set on a match-play event or a game` };
      if (!eligibleParticipantIds.has(id)) return { ok: false, error: `Group ${i + 1}: a member is not an accepted, playing participant` };
    }
    return { ok: false, error: `Group ${i + 1}: a player is in two groups` };
  }
  return { ok: true, value: out };
}
