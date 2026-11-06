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
    // No list poll since PR C (301): the bell and the pulse's signal carry
    // the changes; the provider never calls setInterval.
    expect(provider).not.toMatch(/setInterval\(/);
    expect(provider).not.toMatch(/pollTimerRef/);
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

describe('migration 301: the change signals — the database broadcasts, the client fetches (the cost program PR C)', () => {
  const sql = read('database/migrations/301_pulse_broadcast.sql');
  it('the pre-flight proves realtime.send and realtime.topic exist, and the ledger head', () => {
    expect(sql).toContain("to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL");
    expect(sql).toContain("to_regprocedure('realtime.topic()') IS NULL");
    expect(sql).toContain("IF n < 300 THEN RAISE EXCEPTION '301 pre-flight: ledger head is %, expected 300', n; END IF;");
  });
  it('a person may read broadcasts on their OWN topic only', () => {
    expect(sql).toMatch(/CREATE POLICY "pulse: own user topic" ON realtime\.messages\s+FOR SELECT TO authenticated\s+USING \(realtime\.topic\(\) = 'user:' \|\| \(SELECT auth\.uid\(\)\)::text AND extension = 'broadcast'\)/);
  });
  it('one sender that never fails a write; every trigger function is a definer with an empty search_path', () => {
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.pulse_send\(p_topic text, p_payload jsonb, p_private boolean\)/);
    expect(sql).toMatch(/PERFORM realtime\.send\(p_payload \|\| jsonb_build_object\('at', extract\(epoch FROM now\(\)\)\), 'pulse', p_topic, p_private\);\s+EXCEPTION WHEN OTHERS THEN\s+RAISE WARNING/);
    expect(sql.match(/SECURITY DEFINER\s+SET search_path = ''/g)?.length).toBe(7); // the sender + six trigger functions
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.pulse_send\(text, jsonb, boolean\) FROM PUBLIC, anon, authenticated;/);
  });
  it('live-now (public): golf rounds pending | active, events and their rounds entering or leaving live, broadcasts live + published', () => {
    expect(sql).toMatch(/OLD\.type = 'golf_round' AND OLD\.status IN \('pending', 'active'\)/);
    expect(sql).toMatch(/NEW\.type = 'golf_round' AND NEW\.status IN \('pending', 'active'\)/);
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF status, visibility, date ON public\.group_posts/);
    expect(sql).toMatch(/OLD\.status IS DISTINCT FROM NEW\.status AND \(OLD\.status = 'live' OR NEW\.status = 'live'\)/);
    expect(sql).toMatch(/AFTER UPDATE OF status ON public\.sport_events/);
    expect(sql).toMatch(/AFTER UPDATE OF status ON public\.sport_event_rounds/);
    expect(sql).toMatch(/OLD\.live_status = 'live' AND OLD\.status = 'published'/);
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF live_status, status ON public\.videos/);
    for (const kind of ['golf', 'event', 'broadcast']) expect(sql).toContain(`pulse_send('live-now', jsonb_build_object('kind', '${kind}'), false)`);
  });
  it('user:{id} (private): every active unheld participant on a message (the sender included), the reader on a read, my seat on a live round', () => {
    expect(sql).toMatch(/WHERE cp\.conversation_id = NEW\.conversation_id\s+AND cp\.left_at IS NULL\s+AND cp\.held_at IS NULL/);
    expect(sql).not.toMatch(/sender_id <> /);
    expect(sql).not.toMatch(/is_muted/);
    expect(sql).toMatch(/AFTER INSERT ON public\.messages/);
    expect(sql).toMatch(/OLD\.last_read_at IS DISTINCT FROM NEW\.last_read_at/);
    expect(sql).toMatch(/AFTER UPDATE OF last_read_at ON public\.conversation_participants/);
    expect(sql).toMatch(/gp\.id = round_id AND gp\.type = 'golf_round' AND gp\.status IN \('pending', 'active'\)/);
    expect(sql).toMatch(/AFTER INSERT OR DELETE OR UPDATE OF status ON public\.group_post_participants/);
    expect(sql.match(/pulse_send\('user:' \|\| /g)?.length).toBe(3);
  });
  it('the ledger row and the result row', () => {
    expect(sql).toMatch(/NOTIFY pgrst, 'reload schema';/);
    expect(sql).toMatch(/VALUES \(301, '301_pulse_broadcast\.sql'\)/);
    expect(sql).toMatch(/triggers_expect_7/);
    expect(sql).toMatch(/ledger_head_expect_301/);
  });
  it('the client: the per-user private topic carries the signal; the public topic has one host; the timer is a 10-minute net; the list poll is gone', () => {
    const notifications = read('src/lib/notifications.tsx');
    expect(notifications).toContain(".channel(`user:${user.id}`, { config: { private: true } })");
    expect(notifications).toContain(".on('broadcast', { event: 'pulse' }, () => requestPulse('signal'))");
    const host = read('src/lib/pulse/PulseHost.tsx');
    expect(host).toContain(".channel('live-now')");
    expect(host).toContain(".on('broadcast', { event: 'pulse' }, () => requestPulse('signal'))");
    expect(read('src/app/(app)/layout.tsx')).toContain('<PulseHost />');
    expect(read('src/lib/pulse/pulse-rules.ts')).toContain('export const PULSE_REFRESH_MS = 600_000;');
    const provider = read('src/lib/messages.tsx');
    expect(provider).not.toMatch(/setInterval\(/);
    expect(provider).toContain('if (s.fetchedAt === last.at) return; // a local correction, not an answer');
    const strip = read('src/components/LiveNowStrip.tsx');
    expect(strip).not.toContain('REFRESH_MS = 60_000');
    expect(strip).toContain('if (s.liveNow === lastTotal) return;');
  });
});
