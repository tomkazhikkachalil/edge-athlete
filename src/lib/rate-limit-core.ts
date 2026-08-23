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
  'course-search': { max: 30, windowSeconds: 60, keyBy: 'ip' },
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
  'guardian-athlete-create': { max: 5, windowSeconds: 86400, keyBy: 'user' },
  'co-guardian-invite': { max: 10, windowSeconds: 86400, keyBy: 'user' },
  'credentials-set': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  'invite-claim': { max: 10, windowSeconds: 3600, keyBy: 'user' },
  'gif-search': { max: 60, windowSeconds: 600, keyBy: 'user' },
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
