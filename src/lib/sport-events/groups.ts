/**
 * Playing groups (Events program, PR 5) — pure. The organizer replaces a
 * round's whole plan in one PUT; this validates it against the roster:
 * every member is an accepted, playing participant of the event, nobody
 * is in two groups, positions and sequences are contiguous from 1.
 */
export interface GroupInput {
  name?: string | null;
  tee_time?: string | null;
  starting_hole?: number;
  members: string[];
}

export interface GroupRowPlan {
  sequence: number;
  name: string | null;
  tee_time: string | null;
  starting_hole: number;
  members: Array<{ participant_id: string; position: number }>;
}

export type GroupsPlan = { ok: true; value: GroupRowPlan[] } | { ok: false; error: string };

export const MAX_GROUPS = 60;
export const MAX_GROUP_SIZE = 8;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validateGroupsPlan(body: unknown, eligibleParticipantIds: ReadonlySet<string>): GroupsPlan {
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
      if (typeof m !== 'string' || !UUID.test(m) || seen.has(m) || !eligibleParticipantIds.has(m)) return;
      seen.add(m);
      members.push({ participant_id: m, position: members.length + 1 });
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
      if (typeof m !== 'string' || !UUID.test(m)) return { ok: false, error: `Group ${i + 1}: a member must be a participant id` };
      if (!eligibleParticipantIds.has(m)) return { ok: false, error: `Group ${i + 1}: a member is not an accepted, playing participant` };
    }
    return { ok: false, error: `Group ${i + 1}: a player is in two groups` };
  }
  return { ok: true, value: out };
}
