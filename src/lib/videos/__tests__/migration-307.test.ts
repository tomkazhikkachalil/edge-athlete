import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Game film (307): the game on a video, a tag's event on a highlight, the people in it — pinned at the SQL. */
describe('migration 307 — game film', () => {
  const sql = read('database/migrations/307_video_games.sql');

  it('video_games: one per video, the sport, the day, two sides (a name and optionally a team), coverage, the spoiler default', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.video_games (');
    expect(sql).toContain('ADD CONSTRAINT video_games_pkey PRIMARY KEY (video_id);');
    expect(sql).toContain("coverage text NOT NULL DEFAULT 'highlights' CHECK (coverage IN ('highlights', 'full'))");
    expect(sql).toContain('stats_hidden boolean NOT NULL DEFAULT true');
    expect(sql).toContain('ADD CONSTRAINT video_games_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;');
    for (const side of ['side1', 'side2']) {
      expect(sql).toContain(`ADD CONSTRAINT video_games_${side}_team_id_fkey FOREIGN KEY (${side}_team_id) REFERENCES public.teams(id) ON DELETE SET NULL;`);
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS video_games_${side}_team_id_idx ON public.video_games (${side}_team_id);`);
    }
  });

  it('a highlight gains four nullable columns with their checks — no default, so no rewrite; golf\'s meta is untouched', () => {
    for (const [col, type] of [['event_key', 'text'], ['period', 'smallint'], ['side', 'smallint'], ['value', 'integer']]) {
      expect(sql).toContain(`ALTER TABLE public.video_highlights ADD COLUMN IF NOT EXISTS ${col} ${type};`);
    }
    expect(sql).toContain("CHECK (event_key IS NULL OR event_key ~ '^[a-z0-9_]{2,32}$')");
    expect(sql).toContain('CHECK (side IS NULL OR side IN (1, 2))');
    expect(sql).toContain('CHECK (value IS NULL OR value BETWEEN 0 AND 86400000)');
    expect(sql).not.toMatch(/ALTER TABLE public\.video_highlights[^;]*meta/);
  });

  it('the people in a tag: a profile XOR a typed name, the role, active | removed, once per role', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.video_highlight_people (');
    expect(sql).toContain('CONSTRAINT video_highlight_people_one_person_check CHECK (num_nonnulls(profile_id, name) = 1)');
    expect(sql).toContain("status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed'))");
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS video_highlight_people_profile_role_uidx ON public.video_highlight_people (highlight_id, profile_id, role) WHERE profile_id IS NOT NULL;');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS video_highlight_people_name_role_uidx ON public.video_highlight_people (highlight_id, lower(name), role) WHERE name IS NOT NULL;');
    expect(sql).toContain('ADD CONSTRAINT video_highlight_people_highlight_id_fkey FOREIGN KEY (highlight_id) REFERENCES public.video_highlights(id) ON DELETE CASCADE;');
    expect(sql).toContain('ADD CONSTRAINT video_highlight_people_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;');
    for (const col of ['highlight_id', 'video_id', 'profile_id', 'removed_by_user_id', 'created_by_user_id']) {
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS video_highlight_people_${col}_idx ON public.video_highlight_people (${col});`);
    }
  });

  it('posture A with the service_role grant on both new tables, the ledger footer and the result row', () => {
    for (const t of ['video_games', 'video_highlight_people']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT ALL ON TABLE public.${t} TO service_role;`);
    }
    expect(sql).not.toContain('CREATE POLICY');
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (307, '307_video_games.sql') ON CONFLICT (number) DO NOTHING;");
    expect(sql).toContain("SELECT '307 APPLIED' AS result");
    expect(sql).toContain("IF n < 306 THEN RAISE EXCEPTION '307 pre-flight: ledger head is %, expected 306', n; END IF;");
  });

  it('who was in a tag is the game\'s record: it survives the person, and the one writer and the route are in place', () => {
    expect(read('src/lib/account-departure.ts')).toContain("'video_highlight_people.profile_id': 'survives',");
    const server = read('src/lib/videos/video-games-server.ts');
    expect(server).toContain("{ onConflict: 'video_id' }");
    expect(server).toContain('isMissingTableError(error.code)');
    const route = read('src/app/api/videos/[id]/game/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'video-write' })");
    expect(route).toContain("if (!read.canManage) return NextResponse.json({ error: 'Only a manager can edit this video.' }, { status: 403 });");
    expect(route).toContain("const PRIVATE = { 'Cache-Control': 'private, no-store' };");
  });
});
