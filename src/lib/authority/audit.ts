// ── Authority audit — the pure row builder (migration 240) ──────────────────
// The detail is what an owner may later read in the Activity log and what the
// Edge Athlete team reads in the recovery panel, so it is SANITIZED here: an
// allowlist of keys, strings capped, and nothing that identifies a person
// beyond an id (no email, phone, token — dropped by name, at any depth).

import type { AuthorityAction, AuthorityActor, AuthorityRow, AuthoritySubject } from './types';

export interface AuthorityInput {
  subject: AuthoritySubject;
  actor: AuthorityActor;
  action: AuthorityAction;
  targetProfileId?: string | null;
  ticketId?: string | null;
  detail?: Record<string, unknown>;
}

/** The keys a detail may carry (anything else is dropped). */
export const DETAIL_KEYS = [
  'fields', 'before', 'after', 'role', 'from_role', 'to_role', 'sections', 'scope',
  'revision_id', 'label', 'news_id', 'page_id', 'title', 'slug', 'subdomain', 'domain',
  'listing', 'status', 'from_profile_id', 'to_profile_id', 'participant_id', 'round_ids',
  'note', 'reason', 'expires_at', 'invite_id', 'via',
] as const;

const FORBIDDEN = /email|phone|token|password|secret/i;
const MAX_STRING = 200;
const MAX_ARRAY = 50;
const MAX_DEPTH = 3;

function clean(value: unknown, depth: number): unknown {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  if (Array.isArray(value)) return depth >= MAX_DEPTH ? undefined : value.slice(0, MAX_ARRAY).map(v => clean(v, depth + 1));
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (FORBIDDEN.test(k)) continue;
      const c = clean(v, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  }
  return undefined;
}

export function sanitizeDetail(detail: Record<string, unknown> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!detail) return out;
  for (const key of DETAIL_KEYS) {
    if (!(key in detail)) continue;
    const c = clean(detail[key], 1);
    if (c !== undefined) out[key] = c;
  }
  return out;
}

export class AuthorityRowError extends Error {}

/** The row the one writer inserts. Throws on a shape the table would refuse
 *  (a platform act without its ticket; a member / platform act without an
 *  actor id) — a programming error, caught before the round trip. */
export function buildAuthorityRow(input: AuthorityInput): AuthorityRow {
  const { actor } = input;
  if (actor.kind === 'platform' && !input.ticketId) {
    throw new AuthorityRowError('a platform authority action needs its ticket');
  }
  return {
    subject_type: input.subject.type,
    subject_id: input.subject.id,
    actor_profile_id: actor.kind === 'system' ? null : actor.profileId,
    actor_kind: actor.kind,
    action: input.action,
    target_profile_id: input.targetProfileId ?? null,
    ticket_id: input.ticketId ?? null,
    detail: sanitizeDetail(input.detail),
  };
}
