// ── The owner's view of the authority log (Authority PR 5) ─────────────────
// Pure and zero server imports. The owner of a club or league reads who
// changed who can run it and its public face. The projection IS the access
// rule: an act by the Edge Athlete team reads "Edge Athlete support" — never
// the admin's name, never the ticket, never the team's internal note; the
// detail keeps only what the owner can act on (a title, a slug, a label, the
// listing, the fields changed, a news id to restore). Pinned in
// __tests__/authority-log.test.ts.
import { actionWords } from './words';

export interface StoredAuthorityEntry {
  id: string;
  action: string;
  actor_kind: string;
  actor_profile_id: string | null;
  target_profile_id: string | null;
  ticket_id?: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}

export interface OwnerAuthorityEntry {
  id: string;
  action: string;
  words: string;
  actor: string;
  target: string | null;
  detail: { title?: string; slug?: string; label?: string; listing?: string; fields?: string[]; newsId?: string; subdomain?: string; domain?: string };
  createdAt: string;
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined);

export function projectAuthorityEntry(row: StoredAuthorityEntry, names: ReadonlyMap<string, string>): OwnerAuthorityEntry {
  const actor = row.actor_kind === 'platform'
    ? 'Edge Athlete support'
    : row.actor_kind === 'system'
      ? 'Automatic'
      : (row.actor_profile_id ? names.get(row.actor_profile_id) : undefined) ?? 'A former member';
  const d = row.detail ?? {};
  const detail: OwnerAuthorityEntry['detail'] = {};
  const title = str(d.title); if (title) detail.title = title;
  const slug = str(d.slug); if (slug) detail.slug = slug;
  const label = str(d.label); if (label) detail.label = label;
  const listing = str(d.listing); if (listing) detail.listing = listing;
  const subdomain = str(d.subdomain); if (subdomain) detail.subdomain = subdomain;
  const domain = str(d.domain); if (domain) detail.domain = domain;
  const newsId = str(d.news_id); if (newsId) detail.newsId = newsId;
  if (Array.isArray(d.fields)) detail.fields = d.fields.filter((f): f is string => typeof f === 'string').slice(0, 20);
  return {
    id: row.id,
    action: row.action,
    words: actionWords(row.action),
    actor,
    target: row.target_profile_id ? names.get(row.target_profile_id) ?? 'A former member' : null,
    detail,
    createdAt: row.created_at,
  };
}

/** Keyset paging: the next page starts strictly before this entry's time. */
export const AUTHORITY_LOG_PAGE = 50;
