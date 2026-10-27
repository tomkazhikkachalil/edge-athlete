import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Trip-count program PR 5 (Oct 27 2026): GET /api/notifications is ONE
// database call after the session check — notifications_bell_page (284)
// returns the page's raw rows (limit + 1, with the actor embed), the hidden
// actors (281) and the unread count. Every rule stays in the route.
const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8');

describe('the notifications page is one call', () => {
  const route = read('src/app/api/notifications/route.ts');
  it('one notifications_bell_page call; the GET makes no table read of its own (DELETE keeps its one)', () => {
    expect(route.match(/\.rpc\('notifications_bell_page', \{\s*p_viewer: user\.id,\s*p_limit: limit,\s*p_cursor: cursor,\s*p_unread_only: unreadOnly,\s*p_type: type,\s*\}\)/g)?.length).toBe(1);
    expect(route.match(/\.from\('notifications'\)/g)?.length).toBe(1);
    expect(route).toMatch(/\.from\('notifications'\)\s*\.delete\(\{ count: 'exact' \}\)/);
    expect(route).not.toMatch(/hiddenAuthorsFor/);
    expect(route).not.toMatch(/count: 'exact', head: true/);
  });
  it('the rules did not move: the limit clamp, the hidden-actor filter, has_more from the raw count, the slice, the cursor, the envelope; 503 ahead of 284', () => {
    expect(route).toMatch(/const limit = Math\.min\(Math\.max\(parseInt\(searchParams\.get\('limit'\) \|\| '20', 10\) \|\| 20, 1\), 100\);/);
    expect(route).toMatch(/const hiddenActors = new Set\(page\.hidden \?\? \[\]\);/);
    expect(route).toMatch(/return !actorId \|\| !hiddenActors\.has\(actorId\);/);
    expect(route).toMatch(/const hasMore = notifications\.length > limit;\s*const results = hasMore \? visible\.slice\(0, limit\) : visible;/);
    expect(route).toMatch(/\? results\[results\.length - 1\]\.created_at\s*: null;/);
    expect(route).toMatch(/notifications: results,\s*unread_count: unreadCount \|\| 0,\s*has_more: hasMore,\s*next_cursor: nextCursor/);
    expect(route).toMatch(/error\.code === 'PGRST202'[\s\S]*?\{ error: 'Notifications service updating' \}, \{ status: 503, headers: \{ 'Cache-Control': 'no-store' \} \}/);
  });
});

describe('migration 284', () => {
  const m = read('database/migrations/284_notifications_bell_page.sql');
  it('the route\'s page read verbatim, the actor embed as PostgREST renders it, the hidden actors, the badge\'s count; service_role only', () => {
    expect(m).toMatch(/CREATE OR REPLACE FUNCTION public\.notifications_bell_page\(\s*p_viewer uuid,\s*p_limit int DEFAULT 20,\s*p_cursor timestamptz DEFAULT NULL,\s*p_unread_only boolean DEFAULT false,\s*p_type text DEFAULT NULL\s*\)\s*RETURNS json\s*LANGUAGE sql STABLE SECURITY INVOKER\s*SET search_path = public/);
    expect(m).toMatch(/WHERE n\.user_id = p_viewer\s*AND \(NOT p_unread_only OR n\.is_read = false\)\s*AND \(p_type IS NULL OR n\.type = p_type\)\s*AND \(p_cursor IS NULL OR n\.created_at < p_cursor\)\s*ORDER BY n\.created_at DESC\s*LIMIT GREATEST\(COALESCE\(p_limit, 20\), 0\) \+ 1/);
    expect(m).toMatch(/'id', n\.id, 'type', n\.type, 'title', n\.title, 'message', n\.message, 'action_url', n\.action_url,\s*'is_read', n\.is_read, 'read_at', n\.read_at, 'created_at', n\.created_at,\s*'action_status', n\.action_status, 'action_taken_at', n\.action_taken_at,\s*'grouped_notification_id', n\.grouped_notification_id, 'metadata', n\.metadata,\s*'post_id', n\.post_id, 'comment_id', n\.comment_id, 'follow_id', n\.follow_id,/);
    expect(m).toMatch(/'actor', \(SELECT \(jsonb_build_object\('id', a\.id, 'first_name', a\.first_name, 'middle_name', a\.middle_name,\s*'last_name', a\.last_name, 'full_name', a\.full_name, 'avatar_url', a\.avatar_url,\s*'handle', a\.handle\)\)::json/);
    expect(m).toMatch(/'hidden', to_json\(public\.hidden_authors_for\(p_viewer\)\)/);
    expect(m).toMatch(/'unread_count', \(SELECT count\(\*\) FROM public\.notifications u WHERE u\.user_id = p_viewer AND u\.is_read = false\)/);
    expect(m).toMatch(/REVOKE EXECUTE ON FUNCTION public\.notifications_bell_page\(uuid, int, timestamptz, boolean, text\) FROM PUBLIC, anon, authenticated;/);
    expect(m).toMatch(/GRANT EXECUTE ON FUNCTION public\.notifications_bell_page\(uuid, int, timestamptz, boolean, text\) TO service_role;/);
    expect(m).toMatch(/VALUES \(284, '284_notifications_bell_page\.sql'\)/);
  });
});
