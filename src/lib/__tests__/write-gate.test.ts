import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * THE list of content + contact write routes a limited / suspended / banned
 * account may not use (Support & Reporting, Spec 2). Enforcement is
 * TARGETED on purpose (Tom, Sep 20 2026) — never a blanket on every write —
 * so the list must be visible and pinned: each route below imports the gate
 * (`requireActiveWriter` or `activeWriterRefusal`), and docs/SUPPORT.md
 * names the same list. Adding a route here is a deliberate decision.
 */
export const GATED_WRITE_ROUTES = [
  'posts/route.ts',
  'comments/route.ts',
  'messages/route.ts',
  'messages/[conversationId]/messages/route.ts',
  'group-posts/route.ts',
  'follow/route.ts',
  'tags/route.ts',
  'upload/route.ts',
  'upload/post-media/route.ts',
  'upload/avatar/route.ts',
  'upload/cover/route.ts',
  'upload/equipment/route.ts',
  'profile/route.ts',
  'sport-events/route.ts',
  'sport-events/[id]/participants/join/route.ts',
  'clubs/requests/route.ts',
  'leagues/requests/route.ts',
] as const;

describe('the write gate covers THE list', () => {
  it('every listed route imports the gate', () => {
    for (const rel of GATED_WRITE_ROUTES) {
      const file = path.join(process.cwd(), 'src/app/api', rel);
      const text = fs.readFileSync(file, 'utf8');
      expect(/\b(requireActiveWriter|activeWriterRefusal)\b/.test(text), rel).toBe(true);
    }
  });

  it('the ticket routes are NOT gated — a limited user must still reach support', () => {
    for (const rel of ['tickets/route.ts', 'tickets/[id]/reply/route.ts', 'mutes/route.ts']) {
      const text = fs.readFileSync(path.join(process.cwd(), 'src/app/api', rel), 'utf8');
      expect(/\b(requireActiveWriter|activeWriterRefusal)\b/.test(text), rel).toBe(false);
    }
  });

  it('docs/SUPPORT.md names every listed route', () => {
    const doc = fs.readFileSync(path.join(process.cwd(), 'docs/SUPPORT.md'), 'utf8');
    for (const rel of GATED_WRITE_ROUTES) expect(doc, rel).toContain(rel);
  });
});
