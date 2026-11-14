/**
 * "This is me" (game film round 2, PR 4, Nov 13 2026; migration 308) — pure,
 * no imports. A typed name or a placeholder player becomes a real profile's
 * tags in one of two ways: a manager of the video links it, or the athlete
 * asks and a manager approves — saying which name (or placeholder) they are.
 * The plan of the move is here; the writers are videos-server.ts (the tags)
 * and video-claims-server.ts (the requests).
 */
export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const CLAIM_NAME_MAX = 80;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What is linked: every tag under a typed name (whatever its case, accents or spacing), or a placeholder player's. */
export type LinkTarget = { kind: 'name'; name: string } | { kind: 'placeholder'; profileId: string };

/** One key per typed name: accents, case, punctuation and spacing do not make two people. */
export function claimKey(name: string | null | undefined): string {
  return (name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9' -]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function parseLinkTarget(raw: unknown): Parsed<LinkTarget> {
  if (!isObject(raw)) return { ok: false, error: 'Choose the name or the player to link' };
  const hasName = typeof raw.name === 'string' && raw.name.trim().length > 0;
  const hasProfile = raw.profile_id !== undefined && raw.profile_id !== null;
  if (hasName === hasProfile) return { ok: false, error: 'Choose the name or the player to link' };
  if (hasName) {
    const name = (raw.name as string).trim().replace(/\s+/g, ' ');
    if (name.length > CLAIM_NAME_MAX || !claimKey(name)) return { ok: false, error: 'That name cannot be linked' };
    return { ok: true, value: { kind: 'name', name } };
  }
  if (typeof raw.profile_id !== 'string' || !UUID.test(raw.profile_id)) return { ok: false, error: 'target.profile_id must be a profile id' };
  return { ok: true, value: { kind: 'placeholder', profileId: raw.profile_id.toLowerCase() } };
}

/** POST /api/videos/[id]/claims {name?} — the athlete's request; the name they are under is optional. */
export function parseClaimRequest(body: unknown): Parsed<{ askedName: string | null }> {
  const raw = isObject(body) ? body : {};
  for (const k of Object.keys(raw)) if (k !== 'name') return { ok: false, error: `Unknown field ${k}` };
  if (raw.name === undefined || raw.name === null) return { ok: true, value: { askedName: null } };
  if (typeof raw.name !== 'string') return { ok: false, error: 'name must be text' };
  const name = raw.name.trim().replace(/\s+/g, ' ');
  if (name.length > CLAIM_NAME_MAX) return { ok: false, error: `A name is ${CLAIM_NAME_MAX} characters at most` };
  return { ok: true, value: { askedName: name || null } };
}

/** PATCH /api/videos/[id]/claims/[claimId] — approve (saying who they are) or decline. */
export function parseClaimDecision(body: unknown): Parsed<{ action: 'decline' } | { action: 'approve'; target: LinkTarget }> {
  if (!isObject(body)) return { ok: false, error: 'A decision is required' };
  for (const k of Object.keys(body)) if (k !== 'action' && k !== 'target') return { ok: false, error: `Unknown field ${k}` };
  if (body.action === 'decline') return body.target === undefined ? { ok: true, value: { action: 'decline' } } : { ok: false, error: 'A declined request links nothing' };
  if (body.action !== 'approve') return { ok: false, error: 'action must be approve or decline' };
  const target = parseLinkTarget(body.target);
  return target.ok ? { ok: true, value: { action: 'approve', target: target.value } } : target;
}

/** POST /api/videos/[id]/links {target, profile_id} — a manager links directly. */
export function parseLinkBody(body: unknown): Parsed<{ target: LinkTarget; profileId: string }> {
  if (!isObject(body)) return { ok: false, error: 'A link is required' };
  for (const k of Object.keys(body)) if (k !== 'target' && k !== 'profile_id') return { ok: false, error: `Unknown field ${k}` };
  const target = parseLinkTarget(body.target);
  if (!target.ok) return target;
  if (typeof body.profile_id !== 'string' || !UUID.test(body.profile_id)) return { ok: false, error: 'profile_id must be a profile id' };
  const profileId = body.profile_id.toLowerCase();
  if (target.value.kind === 'placeholder' && target.value.profileId === profileId) return { ok: false, error: 'That is the same player' };
  return { ok: true, value: { target: target.value, profileId } };
}

export interface LinkRow { id: string; highlight_id: string; video_id: string; role: string }
export interface OwnRow { highlight_id: string; video_id: string; role: string; status: string }

/**
 * Which tags move to the profile, which are dropped, which stay. The profile
 * is never tagged back into what it left: a game it removed itself from (its
 * rows there are removed, none active) is skipped whole, and so is a tag it
 * has a removed row on. A tag it is ALREADY on in that role would be twice
 * the same person — the linked row is dropped, the profile's own stays.
 */
export function planLink(rows: readonly LinkRow[], own: readonly OwnRow[]): { move: string[]; drop: string[]; kept: number } {
  const activeIn = new Set<string>();
  const removedIn = new Set<string>();
  const removedOn = new Set<string>();
  const activeOn = new Set<string>();
  for (const r of own) {
    if (r.status === 'removed') {
      removedIn.add(r.video_id);
      removedOn.add(r.highlight_id);
    } else {
      activeIn.add(r.video_id);
      activeOn.add(`${r.highlight_id}|${r.role}`);
    }
  }
  const move: string[] = [];
  const drop: string[] = [];
  let kept = 0;
  const taken = new Set<string>();
  for (const r of rows) {
    const left = removedOn.has(r.highlight_id) || (removedIn.has(r.video_id) && !activeIn.has(r.video_id));
    if (left) { kept += 1; continue; }
    const slot = `${r.highlight_id}|${r.role}`;
    // Two spellings of the name on one tag in one role ("J. Smith", "J Smith") would collide once linked: the second is dropped.
    if (activeOn.has(slot) || taken.has(slot)) { drop.push(r.id); continue; }
    taken.add(slot);
    move.push(r.id);
  }
  return { move, drop, kept };
}

export interface ClaimTarget { kind: 'name' | 'placeholder'; name: string; profile_id: string | null; clips: number }

/** What a manager can link on this video: each typed name once (by key, its first spelling shown) and each placeholder player, with how many clips. */
export function linkTargets(people: ReadonlyArray<{ highlight_id: string; profile_id: string | null; name: string; masked?: boolean }>, placeholderIds: ReadonlySet<string>): ClaimTarget[] {
  const out = new Map<string, { target: ClaimTarget; clips: Set<string> }>();
  for (const p of people) {
    const key = p.profile_id ? (placeholderIds.has(p.profile_id) ? `p:${p.profile_id}` : null) : p.masked ? null : `n:${claimKey(p.name)}`;
    if (!key || key === 'n:') continue;
    const entry = out.get(key) ?? { target: { kind: p.profile_id ? 'placeholder' : 'name', name: p.name, profile_id: p.profile_id, clips: 0 } as ClaimTarget, clips: new Set<string>() };
    entry.clips.add(p.highlight_id);
    out.set(key, entry);
  }
  return [...out.values()].map(e => ({ ...e.target, clips: e.clips.size })).sort((a, b) => a.name.localeCompare(b.name));
}

export const CLAIM_COPY = {
  ask: 'Were you in this game?',
  askNote: 'Ask to have your clips and stats from it on your profile. Someone who manages this video checks it is you.',
  pending: 'Requested. Someone who manages this video will check and link your clips and stats.',
  declined: 'Your request to be linked in this game was not approved.',
  linkConfirm: (target: string, to: string) => `Every tag of “${target}” in this owner's videos becomes ${to}'s: the clips and stats go on their profile, and they are told. They can remove the tags themselves. This is not undone from here.`,
} as const;
