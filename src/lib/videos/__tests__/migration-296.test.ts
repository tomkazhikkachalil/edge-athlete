import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { INTENT_SECTION } from '@/lib/orgs/authz';
import { RATE_LIMITS } from '@/lib/rate-limit-core';
import { PROFILE_FK_POLICY } from '@/lib/account-departure';
import { RESERVED_ROOT_SLUGS } from '@/lib/org-sites/reserved';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

/** Videos (296): the pins that keep the schema honest with the rules. */
describe('migration 296 — videos + video_highlights', () => {
  const sql = read('database/migrations/296_videos.sql');

  it('both tables are posture A: RLS on, revoked from the public roles, granted to service_role, zero policies', () => {
    for (const t of ['videos', 'video_highlights']) {
      expect(sql).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(sql).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(sql).toContain(`GRANT ALL ON TABLE public.${t} TO service_role;`);
    }
    expect(sql).not.toMatch(/CREATE POLICY/);
  });

  it('a video is owned by a profile XOR an org and sits on at most one place', () => {
    expect(sql).toContain('CHECK (num_nonnulls(profile_id, org_id) = 1)');
    expect(sql).toContain('CHECK (num_nonnulls(sport_event_id, contest_id) <= 1)');
  });

  it('the same YouTube video once per owner; the markers\' range rule in the DB', () => {
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS videos_provider_owner_uidx ON public.videos (provider, provider_video_id, coalesce(profile_id, org_id));');
    expect(sql).toContain('start_ms integer NOT NULL CHECK (start_ms >= 0)');
    expect(sql).toContain('end_ms integer CHECK (end_ms IS NULL OR end_ms > start_ms)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS video_highlights_video_id_start_ms_idx ON public.video_highlights (video_id, start_ms);');
  });

  it('the markers cascade with the video; a departed owner takes their videos (goes); the org\'s stay', () => {
    expect(sql).toContain('FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE');
    expect(sql).toContain('FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE');
    expect(PROFILE_FK_POLICY['videos.profile_id']).toBe('goes');
    expect(read('src/lib/account-deletion.ts')).toContain("mustDelete('videos', 'profile_id')");
  });

  it('the new root segment is reserved in code and seeded in the migration', () => {
    expect(RESERVED_ROOT_SLUGS.has('videos')).toBe(true);
    expect(sql).toMatch(/INSERT INTO reserved_handles \(handle, reason\)\s+VALUES \('videos'/);
  });

  it('the ledger footer', () => {
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (296, '296_videos.sql') ON CONFLICT (number) DO NOTHING;");
  });
});

describe('the videos program\'s wiring', () => {
  it('manage_video is the website section\'s grant', () => {
    expect(INTENT_SECTION.manage_video).toBe('website');
  });
  it('every write on /api/videos spends the video-write bucket, per account', () => {
    expect(RATE_LIMITS['video-write']).toMatchObject({ keyBy: 'user' });
    for (const file of ['src/app/api/videos/route.ts', 'src/app/api/videos/[id]/route.ts', 'src/app/api/videos/[id]/highlights/route.ts', 'src/app/api/videos/[id]/highlights/[highlightId]/route.ts']) {
      const src = read(file);
      const writes = src.match(/export async function (POST|PATCH|DELETE)/g) ?? [];
      const gates = src.match(/getServerAuth\(request, \{ limit: 'video-write' \}\)/g) ?? [];
      expect(gates.length, file).toBe(writes.length);
    }
  });
  it('the list route gates a profile context itself (the route-authz audit) and the writer names the one acting-as gate', () => {
    const route = read('src/app/api/videos/route.ts');
    expect(route).toContain('canViewProfile(');
    expect(route).toContain('resolveActingProfile(');
    expect(route).toContain("intent: 'manage_video'");
    expect(read('src/lib/videos/videos-server.ts')).toContain('resolveActingProfile(');
  });
  it('the pure rules stay pure (one erased type import) and the link helper imports only the embed module', () => {
    expect(read('src/lib/videos/rules.ts').match(/^import .*$/gm) ?? []).toEqual(["import type { OrgKind } from '@/lib/orgs/org-ref';"]);
    const imports = read('src/lib/videos/youtube.ts').match(/^import .*$/gm) ?? [];
    expect(imports).toEqual(["import { EMBED_FRAME_HOSTS, embedSrc, parseEmbedUrl } from '@/lib/site-builder/embeds';"]);
  });
});
