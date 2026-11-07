import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Scale round 2 leftovers (Nov 7 2026): `POST /api/messages/[id]/messages`
// made 14 database trips in 13 sequential stages for a plain text message —
// the sender's profile read twice, the participants three times, the
// conversation twice, a redundant limiter call. Now ONE pass reads the sender's
// profile and the conversation's active members (each with their profile and
// the conversation — type, name, frozen_at — embedded), and every rule reads
// those rows: 8 trips in 7 stages. The refusals keep their order and copy.
const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/messages/[conversationId]/messages/route.ts'), 'utf8');

describe('POST /api/messages/[id]/messages: one pass over the rows every rule reads', () => {
  it('the sender profile and the members (with conversation + profile embedded) are read together, once', () => {
    expect(route).toMatch(/const \[\{ data: senderProfile \}, \{ data: memberRows \}\] = await Promise\.all\(\[/);
    expect(route).toContain("conversation:conversations!inner (type, name, frozen_at), profile:profiles (id, handle, supervision_state, messaging_permission)");
    expect(route).toContain(".select('supervision_state, messaging_permission, first_name, last_name, full_name')");
    expect(route.match(/\.from\('profiles'\)/g)?.length).toBe(1);
    expect(route.match(/\.from\('conversation_participants'\)/g)?.length).toBe(1);
    expect(route).not.toContain(".from('conversations')");
    expect(route).not.toContain('conversationFrozen');
    expect(route).not.toContain('enforceRateLimit(');
  });
  it('the frozen rule, the participant guard and the fan-out read the embedded rows', () => {
    expect(route).toContain('if (conversation?.frozen_at) {');
    expect(route).toContain('const me = members.find(m => m.profile_id === user.id && !m.held_at) ?? null;');
    expect(route).toContain('const recipients = others.filter(m => m.is_muted === false && !m.held_at);');
    expect(route).toContain('const others = members.filter(m => m.profile_id !== user.id);');
  });
  it('the supervised path reads both follow directions in one trip; the refusals keep their copy', () => {
    expect(route).toContain("supabase.from('follows').select('follower_id, following_id').eq('status', 'accepted')");
    expect(route.match(/\.from\('follows'\)/g)?.length).toBe(1);
    for (const copy of [
      "Your guardian's messaging setting doesn't allow this conversation.",
      'Conversation not found',
      'This conversation is paused while a report is reviewed.',
      'Cannot message this user',
      'This user is not accepting messages',
      'This user only accepts messages from their fans',
      'This user only accepts messages from mutual fans',
    ]) expect(route).toContain(copy);
    // Eight reads/writes in the file: profiles, participants, follows, blocks ×2, messages ×2 (parent, insert), notifications.
    expect(route.match(/\.from\('/g)?.length).toBe(8);
  });
});
