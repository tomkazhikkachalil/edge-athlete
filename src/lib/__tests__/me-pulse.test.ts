import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The pulse's SQL and wiring (the cost program PR B, Oct 29 2026): migration
// 292's me_pulse mirrors the routes' pure rules, and the store is the ONE
// place that fetches /api/me/pulse — the three polls it replaces are gone
// from the header and the messages provider.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const walk = (dir: string, out: string[] = []): string[] => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(p);
  }
  return out;
};

describe('migration 292: me_pulse mirrors the routes\' rules', () => {
  const sql = read('database/migrations/292_me_pulse.sql');
  it('golf: type golf_round, pending | active, the date within ±48 h of now, public or on the roster with any status but declined', () => {
    expect(sql).toMatch(/gp\.type = 'golf_round'/);
    expect(sql).toMatch(/gp\.status IN \('pending', 'active'\)/);
    expect(sql).toMatch(/\(gp\.date::timestamp AT TIME ZONE 'UTC'\)\s+BETWEEN now\(\) - interval '48 hours' AND now\(\) \+ interval '48 hours'/);
    expect(sql).toMatch(/gp\.visibility = 'public'/);
    expect(sql).toMatch(/gpp\.profile_id = p_viewer\s+AND gpp\.status IS DISTINCT FROM 'declined'/);
  });
  it('events: live, public or the viewer\'s accepted row, and a live round', () => {
    expect(sql).toMatch(/e\.status = 'live'/);
    expect(sql).toMatch(/e\.visibility = 'public'/);
    expect(sql).toMatch(/sp\.profile_id = p_viewer\s+AND sp\.status = 'accepted'/);
    expect(sql).toMatch(/r\.sport_event_id = e\.id AND r\.status = 'live'/);
  });
  it('messages: the existing get_unread_message_count', () => {
    expect(sql).toMatch(/'unread_messages', public\.get_unread_message_count\(p_viewer\)/);
  });
  it('STABLE, invoker, search_path pinned, service_role only, the ledger row and the result row', () => {
    expect(sql).toMatch(/LANGUAGE sql STABLE SECURITY INVOKER\s+SET search_path = public/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.me_pulse\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.me_pulse\(uuid\) TO service_role;/);
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
    expect(sql).toMatch(/VALUES \(292, '292_me_pulse\.sql'\)/);
    expect(sql).toMatch(/ledger_head_expect_292/);
  });
  it('the 48 h window is the pure rule\'s window', () => {
    expect(read('src/lib/golf/round-status.ts')).toMatch(/export const LIVE_WINDOW_MS = 48 \* 60 \* 60 \* 1000;/);
  });
});

describe('migration 300: me_pulse counts live broadcasts under the owner\'s rule (the Videos program, Phase 4a)', () => {
  const sql = read('database/migrations/300_me_pulse_broadcasts.sql');
  it('keeps 292\'s three predicates word for word', () => {
    const prev = read('database/migrations/292_me_pulse.sql');
    for (const frag of ["gp.type = 'golf_round'", "gp.status IN ('pending', 'active')", "gpp.status IS DISTINCT FROM 'declined'", "e.status = 'live'", "sp.status = 'accepted'", "r.sport_event_id = e.id AND r.status = 'live'", "'unread_messages', public.get_unread_message_count(p_viewer)"]) {
      expect(prev).toContain(frag);
      expect(sql).toContain(frag);
    }
  });
  it('broadcasts: published, live, the owner\'s own rule — the owner, a public present profile or an accepted follow; a non-private org, its owner or an org-scoped member', () => {
    expect(sql).toMatch(/v\.live_status = 'live'\s+AND v\.status = 'published'/);
    expect(sql).toMatch(/v\.profile_id = p_viewer/);
    expect(sql).toMatch(/pr\.id = v\.profile_id AND pr\.visibility = 'public' AND pr\.departed_at IS NULL/);
    expect(sql).toMatch(/f\.follower_id = p_viewer AND f\.following_id = v\.profile_id AND f\.status = 'accepted'/);
    expect(sql).toMatch(/o\.visibility <> 'private'\s+OR o\.owner_profile_id = p_viewer/);
    expect(sql).toMatch(/m\.org_id = o\.id AND m\.profile_id = p_viewer AND m\.scope_type = 'org'/);
  });
  it('the pre-flight, STABLE invoker, service_role only, the ledger row and the four-key result', () => {
    expect(sql).toContain("IF n < 299 THEN RAISE EXCEPTION '300 pre-flight: ledger head is %, expected 299', n; END IF;");
    expect(sql).toMatch(/LANGUAGE sql STABLE SECURITY INVOKER\s+SET search_path = public/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.me_pulse\(uuid\) FROM PUBLIC, anon, authenticated;/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.me_pulse\(uuid\) TO service_role;/);
    expect(sql).toMatch(/VALUES \(300, '300_me_pulse_broadcasts\.sql'\)/);
    expect(sql).toContain("array['live_golf', 'live_events', 'live_broadcasts', 'unread_messages']");
  });
  it('the route adds broadcasts into the total and the live-now route answers ?count=1 for the parity spec', () => {
    const route = read('src/app/api/me/pulse/route.ts');
    expect(route).toContain('liveNow: { golf, events, broadcasts, total: golf + events + broadcasts }');
    expect(read('src/app/api/videos/live-now/route.ts')).toContain("searchParams.get('count') === '1'");
    expect(read('src/lib/pulse/pulse-rules.ts')).toContain('liveNow: { golf: number; events: number; broadcasts: number; total: number };');
  });
});

describe('the pulse wiring', () => {
  const files = walk(path.join(ROOT, 'src')).map(f => path.relative(ROOT, f));
  it('only the store fetches /api/me/pulse', () => {
    const fetchers = files.filter(f => /\/api\/me\/pulse'/.test(read(f)) && !/^src\/app\/api\//.test(f));
    expect(fetchers).toEqual(['src/lib/pulse/pulse-store.ts']);
  });
  it('the header no longer polls the two count endpoints', () => {
    const hook = read('src/hooks/useLiveNow.ts');
    expect(hook).not.toMatch(/live-now\/count/);
    expect(hook).not.toMatch(/sport-events\/live-now/);
    expect(hook).toMatch(/subscribePulse\(s => setCount\(s\.liveNow\)\)/);
    expect(hook).toMatch(/requestPulse\('mount'\)/);
  });
  it('the messages provider no longer polls the unread count; it reads the pulse and corrects it on a read', () => {
    const provider = read('src/lib/messages.tsx');
    expect(provider).not.toMatch(/unread-count/);
    expect(provider).toMatch(/subscribePulse\(s => setTotalUnreadCount\(s\.unreadMessages\)\)/);
    expect(provider).toMatch(/adjustPulseUnread\(-unread\)/);
    expect(provider).toMatch(/resetPulse\(\);/);
    // The two-minute list poll fetches the LIST only.
    const poll = provider.slice(provider.indexOf('pollTimerRef.current = setInterval'), provider.indexOf('}, 120_000);'));
    expect(poll).toMatch(/fetchConversations\(pollController\.signal\);/);
    expect(poll).not.toMatch(/refreshUnreadCount/);
  });
  it('the store is a module-level store: one timer, one coalesced fetch, resume catch-up, no provider', () => {
    const store = read('src/lib/pulse/pulse-store.ts');
    expect(store).toMatch(/if \(inFlight\) return inFlight;/);
    expect(store).toMatch(/setInterval\(\(\) => requestPulse\('timer'\), PULSE_REFRESH_MS\)/);
    expect(store).toMatch(/addEventListener\('visibilitychange', onResume\)/);
    expect(store).not.toMatch(/createContext/);
  });
  it('the route is private, no-store and answers 503 ahead of the migration', () => {
    const route = read('src/app/api/me/pulse/route.ts');
    expect(route).toMatch(/'Cache-Control': 'private, no-store'/);
    expect(route).toMatch(/PGRST202/);
    expect(route).toMatch(/rpc\('me_pulse', \{ p_viewer: viewer\.id \}\)/);
  });
});
