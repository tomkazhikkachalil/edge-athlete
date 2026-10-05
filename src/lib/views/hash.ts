import { z } from 'zod';
import { dayKeyUTC, visitorHash } from '@/lib/org-sites/analytics';

// ── Impact: who counts as one person today (252) ──────────────────────────
// Tom: "1000 ppl viewed your post or watched your video." A view counts once
// per person per post per UTC day; nothing about WHO is ever stored — the
// mark is sha256(HMAC(salt, day) ‖ viewer), the org-site analytics rule
// (`visitorHash`), so today's mark cannot be linked to tomorrow's. A signed-in
// viewer is marked by their user id (never their IP — a phone changes
// networks), an anonymous one by ip + user agent. Without a salt nothing is
// counted (a supported, degraded state). Pure; pinned in __tests__/views-hash.test.ts.

export const VIEW_KINDS = ['view', 'play'] as const;
export type ViewKind = (typeof VIEW_KINDS)[number];

/** The beacon body: at most 50 (post, kind) pairs. */
export const ViewItemsSchema = z.object({
  items: z.array(z.object({ id: z.string().uuid(), kind: z.enum(VIEW_KINDS) })).min(1).max(50),
});
export type ViewItem = z.infer<typeof ViewItemsSchema>['items'][number];

export function parseViewItems(body: unknown): ViewItem[] | null {
  const parsed = ViewItemsSchema.safeParse(body);
  if (!parsed.success) return null;
  // One mark per (id, kind) however many times the client repeats it.
  const seen = new Set<string>();
  return parsed.data.items.filter(i => {
    const key = `${i.id}:${i.kind}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The salt: the analytics one, else the HMAC-key family site forms use. */
export function viewSalt(env: { ANALYTICS_SALT?: string; MEDIA_PROXY_SECRET?: string } = process.env as Record<string, string | undefined>): string | null {
  return env.ANALYTICS_SALT || env.MEDIA_PROXY_SECRET || null;
}

export type Viewer = { userId: string } | { ip: string; ua: string };

/** The day's mark for this viewer — never the viewer. */
export function viewerMark(salt: string, day: string, viewer: Viewer): string {
  return 'userId' in viewer ? visitorHash(salt, day, `u:${viewer.userId}`, '') : visitorHash(salt, day, viewer.ip, viewer.ua);
}

export { dayKeyUTC };
