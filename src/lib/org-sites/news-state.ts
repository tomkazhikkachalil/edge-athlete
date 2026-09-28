// The newsroom's rules (sports-team website program, N3, Sep 27 2026) —
// pure, zero imports, node-tested. One save model for a post:
//   • an UNPUBLISHED post (draft or scheduled): an edit writes its columns;
//   • a LIVE post: an edit merges into `draft` (243) — the public copy never
//     shows half-typed text — and "Update" promotes the draft;
//   • Publish: now, or at a time (a future `published_at` = scheduled — the
//     readers fence `published_at <= now`, N1); re-publishing a live post
//     keeps its date (news is dated history).
// The composer sends ONE shape (`NewsEdit`) and never needs to know which.

export type NewsState = 'draft' | 'scheduled' | 'live';

export function newsState(publishedAt: string | null | undefined, nowMs: number): NewsState {
  if (!publishedAt) return 'draft';
  const at = Date.parse(publishedAt);
  if (!Number.isFinite(at)) return 'draft';
  return at > nowMs ? 'scheduled' : 'live';
}

/** What the composer edits — camelCase; `null` clears an optional field. */
export interface NewsEdit {
  title?: string;
  summary?: string | null;
  body?: unknown[];
  coverPath?: string | null;
  teamId?: string | null;
  divisionId?: string | null;
  audience?: 'public' | 'members';
  notifyMembers?: boolean;
  bannerUntil?: string | null;
}

const COLUMN: Record<keyof NewsEdit, string> = {
  title: 'title',
  summary: 'summary',
  body: 'body',
  coverPath: 'cover_path',
  teamId: 'team_id',
  divisionId: 'division_id',
  audience: 'audience',
  notifyMembers: 'notify_members',
  bannerUntil: 'banner_until',
};
const EDIT_KEYS = Object.keys(COLUMN) as (keyof NewsEdit)[];

/** A post is tagged to a team OR a division (243's CHECK): setting one clears the other. */
function withOneTag(edit: NewsEdit): NewsEdit {
  if (edit.teamId) return { ...edit, divisionId: null };
  if (edit.divisionId) return { ...edit, teamId: null };
  return edit;
}

/** The edit as column writes (only the keys it names). */
export function editColumns(edit: NewsEdit): Record<string, unknown> {
  const e = withOneTag(edit);
  const out: Record<string, unknown> = {};
  for (const k of EDIT_KEYS) if (e[k] !== undefined) out[COLUMN[k]] = e[k];
  return out;
}

/** Keep only the known edit keys of a stored draft (defensive: jsonb). */
export function parseDraft(raw: unknown): NewsEdit {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: NewsEdit = {};
  for (const k of EDIT_KEYS) if (k in r) (out as Record<string, unknown>)[k] = r[k];
  return out;
}

/** Where an autosave lands: a LIVE post's edit merges into `draft`; anything else writes the columns. */
export function routeEdit(state: NewsState, edit: NewsEdit, storedDraft: unknown): Record<string, unknown> {
  if (state !== 'live') return editColumns(edit);
  return { draft: withOneTag({ ...parseDraft(storedDraft), ...edit }) };
}

/** "Update": the stored draft becomes the post; the draft clears. Nothing stored → only the clear. */
export function promoteDraft(storedDraft: unknown): Record<string, unknown> {
  return { ...editColumns(parseDraft(storedDraft)), draft: null };
}

export type PublishIntent = { kind: 'now' } | { kind: 'at'; at: string };

/**
 * The `published_at` a publish writes. A LIVE post keeps its date whatever
 * the intent (scheduling it would pull it off the site until then — an easy
 * accident; unpublish first to re-schedule). Otherwise — now: out now
 * (publishing now overrides a schedule); at a time: a future instant
 * schedules, a past or present one means now. Null = nothing to write.
 */
export function publishedAtFor(intent: PublishIntent, current: string | null | undefined, nowMs: number): string | null {
  if (newsState(current, nowMs) === 'live') return null;
  const nowIso = new Date(nowMs).toISOString();
  if (intent.kind === 'now') return nowIso;
  const at = Date.parse(intent.at);
  if (!Number.isFinite(at) || at <= nowMs) return nowIso;
  return new Date(at).toISOString();
}

/** The same instant, whatever the formatting (Postgres vs JS ISO strings). */
export function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return a === b;
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}
