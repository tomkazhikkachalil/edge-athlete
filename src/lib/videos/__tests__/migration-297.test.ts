import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLACE_KEYS } from '@/lib/videos/rules';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Videos Phase 1b (297): the three places, pinned at the SQL and the rules. */
describe('migration 297 — the places a video can sit on', () => {
  const sql = read('database/migrations/297_video_places.sql');

  it('adds the three nullable places, each a SET NULL foreign key with its own index', () => {
    for (const [col, table] of [['group_post_id', 'group_posts'], ['activity_id', 'activities'], ['workout_session_id', 'workout_sessions']] as const) {
      expect(sql).toContain(`ALTER TABLE public.videos ADD COLUMN IF NOT EXISTS ${col} uuid;`);
      expect(sql).toContain(`ALTER TABLE public.videos ADD CONSTRAINT videos_${col}_fkey FOREIGN KEY (${col}) REFERENCES public.${table}(id) ON DELETE SET NULL;`);
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS videos_${col}_idx ON public.videos (${col});`);
    }
  });

  it('widens the one-place rule to the five places and leaves 296 untouched', () => {
    expect(sql).toContain('ALTER TABLE public.videos DROP CONSTRAINT IF EXISTS videos_one_place_check;');
    expect(sql).toContain('ADD CONSTRAINT videos_one_place_check CHECK (num_nonnulls(sport_event_id, contest_id, group_post_id, activity_id, workout_session_id) <= 1);');
    expect(read('database/migrations/296_videos.sql')).toContain('CHECK (num_nonnulls(sport_event_id, contest_id) <= 1)');
    // The rules' list IS the SQL's list, in order.
    expect([...PLACE_KEYS]).toEqual(['sport_event_id', 'contest_id', 'group_post_id', 'activity_id', 'workout_session_id']);
  });

  it('no profile foreign key (nothing new to classify), the ledger footer', () => {
    expect(sql).not.toMatch(/REFERENCES public\.profiles/);
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (297, '297_video_places.sql') ON CONFLICT (number) DO NOTHING;");
  });
});

describe('the writer and the door carry the three places', () => {
  it('the list route answers the three contexts and the writer reads the places by name', () => {
    const route = read('src/app/api/videos/route.ts');
    for (const p of ['groupPostId', 'activityId', 'workoutSessionId']) expect(route).toContain(`searchParams.get('${p}')`);
    const server = read('src/lib/videos/videos-server.ts');
    expect(server).toContain('group_post:group_posts(id, title, date, golf_data:golf_scorecard_data(course_name))');
    expect(server).toContain('activity:activities(id, name)');
    expect(server).toContain('workout_session:workout_sessions(id, title)');
    // The gates the places borrow — never a rule of their own.
    expect(server).toContain('canViewSharedRound(');
    expect(server).toContain('readActivityForViewer(');
    expect(server).toContain("aspectHidden(await fetchTrainingPrivacy(admin, session.profile_id), 'workouts', false)");
  });
  it('the door prefills the three places and names the existing row on a 409', () => {
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    for (const p of ['groupPostId', 'activityId', 'workoutSessionId']) expect(flow).toContain(`params.get('${p}')`);
    expect(flow).toContain('data-new-video-existing=');
  });
});
