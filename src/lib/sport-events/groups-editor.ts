/**
 * The groups editor's operations (Events program, PR 12) — pure. The
 * organizer arranges the accepted, playing participants into groups; the
 * whole plan is saved in one PUT (`groups.ts validateGroupsPlan` is the
 * server's rule). Every operation returns a new array; nothing mutates.
 */
export interface EditorGroup {
  key: string;
  name: string;
  /** "HH:MM" in the organizer's clock, or ''. */
  teeTime: string;
  startingHole: number;
  members: string[];
}

export interface EditorPlayer {
  participantId: string;
  name: string;
}

let seq = 0;
const nextKey = () => `g${Date.now().toString(36)}${(seq++).toString(36)}`;

/** "HH:MM" from a tee_time ISO string in the local clock. */
export function teeTimeToLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The ISO tee time for a "HH:MM" on the round's date (local clock); null when blank. */
export function localToTeeTime(dateOnly: string, hhmm: string): string | null {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateOnly);
  if (!m || !d) return null;
  const local = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(m[1]), Number(m[2]), 0, 0);
  return Number.isFinite(local.getTime()) ? local.toISOString() : null;
}

/** The editor's groups from the saved plan. */
export function groupsFromSaved(saved: Array<{ id: string; sequence: number; name: string | null; tee_time: string | null; starting_hole: number; members: Array<{ participant_id: string; position: number }> }>): EditorGroup[] {
  return [...saved]
    .sort((a, b) => a.sequence - b.sequence)
    .map(g => ({ key: g.id, name: g.name ?? '', teeTime: teeTimeToLocal(g.tee_time), startingHole: g.starting_hole, members: [...g.members].sort((a, b) => a.position - b.position).map(m => m.participant_id) }));
}

/** Players in no group, in roster order. */
export function unassigned(players: EditorPlayer[], groups: EditorGroup[]): EditorPlayer[] {
  const placed = new Set(groups.flatMap(g => g.members));
  return players.filter(p => !placed.has(p.participantId));
}

export function addGroup(groups: EditorGroup[]): EditorGroup[] {
  return [...groups, { key: nextKey(), name: '', teeTime: '', startingHole: 1, members: [] }];
}

export function removeGroup(groups: EditorGroup[], key: string): EditorGroup[] {
  return groups.filter(g => g.key !== key);
}

export function updateGroup(groups: EditorGroup[], key: string, patch: Partial<Pick<EditorGroup, 'name' | 'teeTime' | 'startingHole'>>): EditorGroup[] {
  return groups.map(g => (g.key === key ? { ...g, ...patch } : g));
}

/** Put a player in a group (out of any other first); at the end of it. */
export function assign(groups: EditorGroup[], participantId: string, key: string): EditorGroup[] {
  return groups.map(g => {
    const without = g.members.filter(id => id !== participantId);
    return g.key === key ? { ...g, members: [...without, participantId] } : { ...g, members: without };
  });
}

export function unassign(groups: EditorGroup[], participantId: string): EditorGroup[] {
  return groups.map(g => ({ ...g, members: g.members.filter(id => id !== participantId) }));
}

export function reorderMembers(groups: EditorGroup[], key: string, ids: string[]): EditorGroup[] {
  return groups.map(g => {
    if (g.key !== key) return g;
    const known = new Set(g.members);
    const next = ids.filter(id => known.has(id));
    return next.length === g.members.length ? { ...g, members: next } : g;
  });
}

export function moveGroup(groups: EditorGroup[], key: string, dir: -1 | 1): EditorGroup[] {
  const i = groups.findIndex(g => g.key === key);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= groups.length) return groups;
  const next = [...groups];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Drop players who are no longer eligible (withdrew, were removed). */
export function pruneTo(groups: EditorGroup[], eligible: Set<string>): EditorGroup[] {
  return groups.map(g => ({ ...g, members: g.members.filter(id => eligible.has(id)) }));
}

/** The PUT body — empty groups are kept (an organizer may set tee times before assigning). */
export function toPlanBody(groups: EditorGroup[], roundDate: string) {
  return {
    groups: groups.map(g => ({
      name: g.name.trim() || null,
      tee_time: localToTeeTime(roundDate, g.teeTime),
      starting_hole: g.startingHole,
      members: g.members,
    })),
  };
}

/** Same plan? (order, names, times, holes, members) */
export function samePlan(a: EditorGroup[], b: EditorGroup[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((g, i) => {
    const h = b[i];
    return g.name.trim() === h.name.trim() && g.teeTime === h.teeTime && g.startingHole === h.startingHole && g.members.length === h.members.length && g.members.every((m, j) => m === h.members[j]);
  });
}

// ── Regroup by standing (Events program, phase 2) ────────────────────────────

export interface StandingRow {
  participantId: string;
  /** The overall rank (shared), null when unranked. */
  rank: number | null;
  /** false = missed the cut: never in a later round's groups. */
  madeCut: boolean | null;
}

export interface StandingGroupOptions {
  groupSize: 2 | 3 | 4 | 5;
  /** leaders_last = the PGA norm (the leaders tee off last); leaders_first = the leaders go out first. */
  order: 'leaders_last' | 'leaders_first';
  /** Optional tee times: the first group's "HH:MM" and the minutes between groups. */
  teeTimes?: { first: string; intervalMin: number } | null;
}

/** "HH:MM" plus minutes, wrapping at midnight. */
export function addMinutes(hhmm: string, minutes: number): string {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const total = ((Number(m[1]) * 60 + Number(m[2]) + minutes) % (24 * 60) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * The next round's groups from the overall standing: the missed-cut set is
 * left out; the standing is the ranked players by rank (ties keep their
 * board order) with the unranked at its end; the tee order is that
 * standing reversed for leaders_last (the worst out first, the leaders in
 * the last group) or as is for leaders_first; the groups are chunks of
 * `groupSize` and the SHORT group, when the field does not divide, is the
 * first to tee off (the norm — nobody waits behind a twosome). "Group n";
 * hole 1; tee times spaced when given.
 */
export function groupsByStanding(rows: ReadonlyArray<StandingRow>, opts: StandingGroupOptions): EditorGroup[] {
  const eligible = rows.filter(r => r.madeCut !== false);
  const ranked = eligible.filter(r => r.rank !== null).sort((a, b) => (a.rank as number) - (b.rank as number));
  const unranked = eligible.filter(r => r.rank === null);
  const standing = [...ranked, ...unranked].map(r => r.participantId);
  const teeOrder = opts.order === 'leaders_last' ? [...standing].reverse() : standing;
  if (teeOrder.length === 0) return [];
  const size = Math.min(5, Math.max(2, opts.groupSize));
  const remainder = teeOrder.length % size;
  const sizes: number[] = [];
  if (remainder > 0) sizes.push(remainder);
  for (let n = teeOrder.length - remainder; n > 0; n -= size) sizes.push(size);
  const out: EditorGroup[] = [];
  let at = 0;
  sizes.forEach((n, i) => {
    out.push({
      key: nextKey(),
      name: `Group ${i + 1}`,
      teeTime: opts.teeTimes ? addMinutes(opts.teeTimes.first, opts.teeTimes.intervalMin * i) : '',
      startingHole: 1,
      members: teeOrder.slice(at, at + n),
    });
    at += n;
  });
  return out;
}
