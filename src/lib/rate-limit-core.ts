// Pure core of the rate limiter: config + key/header arithmetic, no
// framework or Supabase imports so the node-only vitest suite can cover it
// (the storage-sweep/guardian-invites pattern). The server glue that talks
// to Postgres lives in ./rate-limit.ts and re-exports everything here.

export interface RateLimitRule {
  /** Requests allowed per window. */
  max: number;
  windowSeconds: number;
  /** 'ip' = unauthenticated surface; 'user' = per-account. */
  keyBy: 'ip' | 'user';
  /** Optional 429 body override (login UIs surface this text). */
  message?: string;
}

const ATTEMPTS_MESSAGE = 'Too many attempts. Please wait a few minutes.';

// The single tuning surface. One named action per throttled behaviour;
// actions shared across routes ('upload', 'like') pool their budget on
// purpose. Windows are fixed (reset windowSeconds after the first hit),
// enforced atomically in Postgres by rate_limit_hit() (migration 094).
export const RATE_LIMITS = {
  // ── Unauthenticated (IP-keyed): no account cost to an attacker ──────────
  contact: { max: 5, windowSeconds: 600, keyBy: 'ip' },
  waitlist: { max: 5, windowSeconds: 3600, keyBy: 'ip' },
  signup: { max: 5, windowSeconds: 3600, keyBy: 'ip' },
  activate: { max: 5, windowSeconds: 900, keyBy: 'ip', message: ATTEMPTS_MESSAGE },
  // Two buckets on username-login: the per-(ip,username) bucket alone lets a
  // distributed attacker probe many usernames from one IP — the plain-IP
  // bucket closes that.
  'username-login': { max: 5, windowSeconds: 900, keyBy: 'ip', message: ATTEMPTS_MESSAGE },
  'username-login-ip': { max: 20, windowSeconds: 900, keyBy: 'ip', message: ATTEMPTS_MESSAGE },
  reauth: { max: 5, windowSeconds: 900, keyBy: 'ip', message: ATTEMPTS_MESSAGE },
  'handle-check': { max: 30, windowSeconds: 60, keyBy: 'ip' },
  // Course picker search — anonymous-reachable and it reads cross-user
  // course history; the golf_courses catalog makes it a scraping target.
  // 120/min, not 30: a typing user fires one request per debounced
  // keystroke plus browse-on-focus, and 30 was hit in normal composing
  // (Tom, Aug 23). Still throttles enumeration to a crawl.
  'course-search': { max: 120, windowSeconds: 60, keyBy: 'ip' },
  // ⌘K + Explore search — anonymous-reachable fan-out over profiles, posts,
  // clubs and courses (search_all, migration 112). Same budget and rationale
  // as course-search: a typing user fires one debounced request per
  // keystroke, so 30/min breaks normal use; 120 still crawls enumeration.
  search: { max: 120, windowSeconds: 60, keyBy: 'ip' },
  // Guardian-invite peek — unauthenticated (parents open it accountless)
  // and a valid hit names the invited email; keep token guessing costly.
  'invite-peek': { max: 30, windowSeconds: 60, keyBy: 'ip' },

  // ── Authenticated (user-keyed): spam-shaped or expensive writes ─────────
  'account-delete': { max: 5, windowSeconds: 900, keyBy: 'user', message: ATTEMPTS_MESSAGE },
  upload: { max: 60, windowSeconds: 3600, keyBy: 'user' },
  'post-create': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  'comment-create': { max: 60, windowSeconds: 600, keyBy: 'user' },
  like: { max: 120, windowSeconds: 600, keyBy: 'user' },
  follow: { max: 60, windowSeconds: 3600, keyBy: 'user' },
  'conversation-create': { max: 20, windowSeconds: 3600, keyBy: 'user' },
  'message-send': { max: 120, windowSeconds: 600, keyBy: 'user' },
  'message-report': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  'guardian-escalate': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  // Athlete creation only. Household block-adds and apply-to-all used to
  // share this 5/day bucket (Wave 4/5), which meant a parent doing a normal
  // setup evening — add two kids, apply defaults, block one account — could
  // starve athlete creation. Each family now has its own bucket below.
  'guardian-athlete-create': { max: 5, windowSeconds: 86400, keyBy: 'user' },
  // Household block-adds: a safety action, so the budget must never starve a
  // guardian mid-incident; 20/day is far past real use while still capping a
  // runaway client.
  'guardian-block': { max: 20, windowSeconds: 86400, keyBy: 'user' },
  // Apply-to-all household defaults: idempotent bulk write, rare by nature.
  'guardian-household-apply': { max: 10, windowSeconds: 86400, keyBy: 'user' },
  'co-guardian-invite': { max: 10, windowSeconds: 86400, keyBy: 'user' },
  'credentials-set': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  'invite-claim': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  'gif-search': { max: 60, windowSeconds: 600, keyBy: 'user' },
  // League join/leave toggle — same shape as 'follow' but tighter: joining
  // is rarer than following and a join fan-outs a notification to the owner.
  'league-join': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  // Roster offers fan out one notification each (0.3) — league-join's shape.
  'roster-offer': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  // "Start a league" submissions — rare by nature, each lands in the admin
  // queue; 3/day per user keeps a griefing account from flooding it while
  // never touching a genuine requester (one pending at a time anyway).
  'league-request': { max: 3, windowSeconds: 86400, keyBy: 'user' },
  // Clubs mirror the league buckets (117): same shapes, same rationale.
  'club-join': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  'club-request': { max: 3, windowSeconds: 86400, keyBy: 'user' },
  // Affiliation invites/requests (118) — org-manager actions; 20/h never
  // touches a real manager and, with delete-on-decline, is the backstop
  // against re-invite spam.
  affiliation: { max: 20, windowSeconds: 3600, keyBy: 'user' },
  // Calendar event creation — org events fan a team_update out to every
  // member (uncapped membership), so creation gets post-create parity.
  'event-create': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  // Carpool offers/claims (Wave 9, mig 139): each fans a notification out
  // to the event's guests or the driver; 20/h never touches real use.
  'carpool-offer': { max: 20, windowSeconds: 3600, keyBy: 'user' },
  'carpool-claim': { max: 20, windowSeconds: 3600, keyBy: 'user' },
  // Group rounds create a post + fan out to N participants — post-create
  // parity; late adds are rarer but batched, 60/h never touches real use.
  'group-post-create': { max: 30, windowSeconds: 3600, keyBy: 'user' },
  'group-post-add': { max: 60, windowSeconds: 3600, keyBy: 'user' },
  // CSP violation sink: anon-reachable, a broken page can fire dozens of
  // reports per load. On limit the route still 204s (never 429 a reporter).
  'csp-report': { max: 30, windowSeconds: 60, keyBy: 'ip' },
  // Authenticated media proxy (/api/media/[token]). IP-keyed (anon-reachable
  // for public content) and generous: an image-dense page pulls dozens of
  // media in one load. Forged tokens die on the HMAC check before any DB hit,
  // and public bytes are CDN-cached, so this mainly caps bandwidth abuse.
  media: { max: 600, windowSeconds: 60, keyBy: 'ip' },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitAction = keyof typeof RATE_LIMITS;

/** First hop of an x-forwarded-for header, trimmed; null when absent/empty. */
export function firstForwardedIp(xff: string | null): string | null {
  if (!xff) return null;
  const first = xff.split(',')[0]?.trim();
  return first ? first : null;
}

export function buildRateLimitKey(
  action: string,
  identifier: string,
  extraKey?: string
): string {
  return `${action}:${identifier}${extraKey ? `:${extraKey}` : ''}`;
}

const RETRY_AFTER_CAP_SECONDS = 86400;

/** Sanitize an RPC-returned retry-after into a usable header value. */
export function clampRetryAfter(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return Math.min(Math.ceil(n), RETRY_AFTER_CAP_SECONDS);
}

/** Returns human-readable violations; empty array = config is sound. */
export function validateRateLimitConfig(
  cfg: Record<string, RateLimitRule>
): string[] {
  const violations: string[] = [];
  for (const [action, rule] of Object.entries(cfg)) {
    if (!action || action.includes(':')) {
      violations.push(`action "${action}" is empty or contains ':' (the key separator)`);
    }
    if (!Number.isInteger(rule.max) || rule.max <= 0) {
      violations.push(`${action}: max must be a positive integer`);
    }
    if (!Number.isInteger(rule.windowSeconds) || rule.windowSeconds <= 0) {
      violations.push(`${action}: windowSeconds must be a positive integer`);
    }
    if (rule.keyBy !== 'ip' && rule.keyBy !== 'user') {
      violations.push(`${action}: keyBy must be 'ip' or 'user'`);
    }
  }
  return violations;
}
