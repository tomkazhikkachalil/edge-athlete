import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Videos Phase 4a (299): a linked broadcast the app knows is live, pinned at the SQL. */
describe('migration 299 — live', () => {
  const sql = read('database/migrations/299_video_live.sql');

  it('five columns on videos, the status words as a named CHECK, the partial index for what is or will be live', () => {
    for (const col of ['live_status text NOT NULL DEFAULT \'none\'', 'scheduled_start_at timestamptz', 'live_started_at timestamptz', 'live_ended_at timestamptz', 'live_checked_at timestamptz']) {
      expect(sql).toContain(`ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS ${col};`);
    }
    expect(sql).toContain("ADD CONSTRAINT videos_live_status_check CHECK (live_status IN ('none', 'upcoming', 'live', 'ended'));");
    expect(sql).toContain("CREATE INDEX IF NOT EXISTS videos_live_idx ON public.videos (live_status, scheduled_start_at) WHERE live_status IN ('upcoming', 'live');");
    expect(sql).not.toMatch(/REFERENCES/); // no FK — nothing for fk-index-coverage, nothing for departure
  });

  it('the pre-flight, the ledger footer and the result row', () => {
    expect(sql).toContain("IF n < 298 THEN RAISE EXCEPTION '299 pre-flight: ledger head is %, expected 298', n; END IF;");
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (299, '299_video_live.sql') ON CONFLICT (number) DO NOTHING;");
    expect(sql).toContain("SELECT '299 APPLIED' AS result");
    expect(sql).toContain('AS columns_expect_5');
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
  });

  it('the code reads the five columns and the view carries four (never the lock)', () => {
    const server = read('src/lib/videos/videos-server.ts');
    expect(server).toContain('live_status, scheduled_start_at, live_started_at, live_ended_at, live_checked_at, created_at, updated_at');
    const types = read('src/lib/videos/types.ts');
    expect(types.split('live_status: LiveStatus;').length - 1).toBe(2);
    expect(types.split('live_checked_at: string | null;').length - 1).toBe(1);
  });
});
