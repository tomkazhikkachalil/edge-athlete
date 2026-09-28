// The newsroom's view model (sports-team website program, N4, Sep 27 2026)
// — what the editor's News window lists and what its composer shows. Pure.

import { newsState, parseDraft, type NewsEdit, type NewsState } from './news-state';

export interface NewsRow {
  id: string;
  slug: string;
  title: string;
  published_at: string | null;
  updated_at?: string;
  created_at?: string;
  summary?: string | null;
  cover_path?: string | null;
  team_id?: string | null;
  division_id?: string | null;
  audience?: 'public' | 'members';
  pinned_at?: string | null;
  body?: unknown;
  draft?: unknown;
}

export interface NewsGroups {
  drafts: NewsRow[];
  scheduled: NewsRow[];
  live: NewsRow[];
}

/** Drafts newest-edited first; scheduled soonest first; live newest first. */
export function groupNews(rows: readonly NewsRow[], nowMs: number): NewsGroups {
  const out: NewsGroups = { drafts: [], scheduled: [], live: [] };
  for (const r of rows) {
    const s = newsState(r.published_at, nowMs);
    (s === 'draft' ? out.drafts : s === 'scheduled' ? out.scheduled : out.live).push(r);
  }
  const t = (v: string | null | undefined) => (v ? Date.parse(v) || 0 : 0);
  out.drafts.sort((a, b) => t(b.updated_at ?? b.created_at) - t(a.updated_at ?? a.created_at));
  out.scheduled.sort((a, b) => t(a.published_at) - t(b.published_at));
  out.live.sort((a, b) => t(b.published_at) - t(a.published_at));
  return out;
}

/** The composer's form: the post's columns, with a LIVE post's pending draft on top. */
export interface ComposerValues {
  title: string;
  summary: string;
  body: unknown[];
  coverPath: string | null;
  teamId: string | null;
  divisionId: string | null;
  audience: 'public' | 'members';
}

export function composerValues(row: NewsRow): ComposerValues {
  const base: ComposerValues = {
    title: row.title ?? '',
    summary: row.summary ?? '',
    body: Array.isArray(row.body) ? row.body : [],
    coverPath: row.cover_path ?? null,
    teamId: row.team_id ?? null,
    divisionId: row.division_id ?? null,
    audience: row.audience === 'members' ? 'members' : 'public',
  };
  const d: NewsEdit = parseDraft(row.draft);
  return {
    title: typeof d.title === 'string' ? d.title : base.title,
    summary: d.summary !== undefined ? (d.summary ?? '') : base.summary,
    body: Array.isArray(d.body) ? d.body : base.body,
    coverPath: d.coverPath !== undefined ? d.coverPath : base.coverPath,
    teamId: d.teamId !== undefined ? d.teamId : base.teamId,
    divisionId: d.divisionId !== undefined ? d.divisionId : base.divisionId,
    audience: d.audience ?? base.audience,
  };
}

/** A live post whose draft holds edits not yet on the site ("press Update"). */
export function hasPendingDraft(row: NewsRow, nowMs: number): boolean {
  return newsState(row.published_at, nowMs) === 'live' && Object.keys(parseDraft(row.draft)).length > 0;
}

/** The composer's status line for the post's state. */
export function stateLine(state: NewsState, publishedAt: string | null, pending: boolean): string {
  if (state === 'draft') return 'Draft — only you can see it.';
  if (state === 'scheduled') return `Scheduled — goes live ${publishedAt ? new Date(publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'later'}.`;
  return pending ? 'Live — your latest changes are not on the site yet. Press Update.' : 'Live on your site.';
}
