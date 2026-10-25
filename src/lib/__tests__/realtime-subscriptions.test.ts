import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Scale fix 1 (Oct 25 2026, docs/SCALE_AUDIT.md hole 1): Realtime delivers a
// change event once PER SUBSCRIBER, so a postgres_changes listener on a
// published table must carry a server-side `filter:` — never the whole
// table. One unfiltered listener on golf_participant_scores sent every score
// written anywhere to every spectator and live feed card. Read from the
// source: every listener on a published table is filtered, and the
// publication carries the tables the hooks listen to.
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
const PUBLISHED = ['golf_participant_scores', 'group_posts', 'messages', 'notifications', 'group_post_participants'];

describe('Realtime: every postgres_changes listener on a published table is filtered', () => {
  const files = walk(path.join(ROOT, 'src'));
  // Each `{ event: …, schema: 'public', table: 'X' … }` object literal of a postgres_changes listener.
  const listenerRe = /\{\s*event:[^}]*?schema:\s*'public'[^}]*?table:\s*'([a-z_]+)'[^}]*\}/g;
  it('finds the listeners (the regex is live)', () => {
    const hook = read('src/hooks/useSharedRound.ts');
    expect([...hook.matchAll(listenerRe)].length).toBeGreaterThanOrEqual(3);
  });
  it('no listener on a published table is unfiltered — except useSharedRound\'s documented >100-roster fallback', () => {
    const offenders: string[] = [];
    for (const f of files) {
      const code = read(path.relative(ROOT, f));
      for (const m of code.matchAll(listenerRe)) {
        const table = m[1];
        if (!PUBLISHED.includes(table)) continue;
        if (/filter:/.test(m[0])) continue;
        // The one allowed unfiltered shape: the roster-over-100 fallback in useSharedRound, guarded by REALTIME_IN_FILTER_MAX.
        const rel = path.relative(ROOT, f);
        if (rel === 'src/hooks/useSharedRound.ts' && /roster\.length > REALTIME_IN_FILTER_MAX/.test(code)) continue;
        offenders.push(`${rel}: ${m[0].replace(/\s+/g, ' ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });
  it('useSharedRound filters scores to the roster and hears the round\'s joiners', () => {
    const hook = read('src/hooks/useSharedRound.ts');
    expect(hook).toMatch(/filter: `participant_id=in\.\(\$\{roster\.join\(','\)\}\)`/);
    expect(hook).toMatch(/table: 'group_post_participants', filter: `group_post_id=eq\.\$\{groupPostId\}`/);
    expect(hook).toMatch(/\[enabled, groupPostId, refresh, retryNonce, rosterKey\]/); // a roster change resubscribes
    expect(hook).toMatch(/const REALTIME_IN_FILTER_MAX = 100;/);
  });
  // Scale fix 3 (hole 3): the conversation LIST has no channel of its own —
  // the `new_message` bell on the ONE per-user notifications channel is its
  // live signal; presence is joined only while the dock is in use.
  it('the messages provider holds no Realtime channel; the new_message bell is its signal', () => {
    const provider = read('src/lib/messages.tsx');
    expect(provider).not.toMatch(/\.channel\(/);
    expect(provider).not.toMatch(/from '@\/lib\/supabase'/);
    expect(provider).toMatch(/notifications\.filter\(n => n\.type === 'new_message'\)/);
    expect(provider).toMatch(/\[notifications, user, fetchConversations, refreshUnreadCount\]/);
  });
  it('presence joins only while the dock is in use (panel open or a thread open / minimized)', () => {
    const dock = read('src/components/chat-dock/ChatDock.tsx');
    expect(dock).toMatch(/const presenceWanted = enabled && !suppressed && \(\(open && !hidden\) \|\| hasWindows\);/);
    expect(dock).toMatch(/usePresence\(presenceWanted \? user!\.id : null\)/);
    const hook = read('src/components/chat-dock/usePresence.ts');
    expect(hook).toMatch(/if \(!userId\) return;/); // a null id = no channel
  });
  it('migration 273 publishes group_post_participants', () => {
    const m = read('database/migrations/273_publish_group_post_participants.sql');
    expect(m).toMatch(/ALTER PUBLICATION supabase_realtime ADD TABLE public\.group_post_participants;/);
    expect(m).toMatch(/published_tables_expect_5/);
  });
});
