-- ============================================================================
-- 298: the YouTube connection — a channel connected ONCE, per profile or per
--      org, so a full game can be uploaded straight to it and its uploads
--      linked in one tap (Nov 5 2026; the Videos program, Phase 3). Runs on
--      BOTH staging and prod BEFORE the code deploys.
-- ============================================================================
-- Tom: "any area where you can upload videos should have the YouTube
-- integration." Phases 1–1b link a YouTube video by id; Phase 3 connects the
-- channel. ONE table, the activity_connections (247) shape with what 247
-- lacked:
--
--   youtube_connections — ONE row per owner (a profile XOR an org).
--     connected_by_user_id  the person whose Google account granted it. An
--                   org's connection is the channel OWNER's grant, never an
--                   app role: a manager may link and mark (manage_video),
--                   but only this person uploads to the channel.
--     channel_id / channel_title  what Google said the channel is.
--     scopes        the consent given so far, incremental — 'readonly' at
--                   connect (the channel's uploads to link), 'upload' when
--                   the first upload asks for it.
--     secret_ciphertext  the refresh token, the access token and its expiry,
--                   sealed by the app (AES-256-GCM, crypto/secret-box-
--                   server.ts) — the database never holds a usable token.
--     status        active | revoked (Google refused the refresh —
--                   invalid_grant: the consent was withdrawn, or the OAuth
--                   app is in Testing and the week ran out) | error.
--     last_error    in our words, never a token.
--   Disconnecting DELETES the row (and revokes at Google, best effort); the
--   videos it uploaded stay the owner's rows.
--   Posture A: RLS on, no policies, service role only; the projection in
--   src/lib/videos/youtube-connection.ts IS the access rule (never the
--   ciphertext in any response).
--
-- The table is created EMPTY, so its indexes are inline. The primary key,
-- the FKs and the uniques are named ALTERs (live-schema.ts reads named
-- constraints). Every FK has its index (fk-index-coverage). The profile FK
-- CASCADEs → PROFILE_FK_POLICY 'goes' + mustDelete (account-departure /
-- account-deletion).
--
-- REVERSAL: DROP TABLE public.youtube_connections;
-- A second run stops in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 298) THEN
    RAISE EXCEPTION '298 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 297 THEN RAISE EXCEPTION '298 pre-flight: ledger head is %, expected 297', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'videos') THEN
    RAISE EXCEPTION '298 pre-flight: public.videos is missing — 296 has not run here';
  END IF;
END $$;

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.youtube_connections (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  profile_id uuid,
  org_id uuid,
  connected_by_user_id uuid NOT NULL,
  channel_id text NOT NULL CHECK (char_length(channel_id) BETWEEN 1 AND 100),
  channel_title text CHECK (channel_title IS NULL OR char_length(channel_title) BETWEEN 1 AND 200),
  scopes text[] NOT NULL DEFAULT '{}'::text[],
  secret_ciphertext text CHECK (secret_ciphertext IS NULL OR char_length(secret_ciphertext) BETWEEN 1 AND 8000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked', 'error')),
  last_error text CHECK (last_error IS NULL OR char_length(last_error) BETWEEN 1 AND 300),
  connected_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT youtube_connections_one_owner_check CHECK (num_nonnulls(profile_id, org_id) = 1),
  CONSTRAINT youtube_connections_secret_check CHECK (status <> 'active' OR secret_ciphertext IS NOT NULL)
);

ALTER TABLE public.youtube_connections DROP CONSTRAINT IF EXISTS youtube_connections_pkey;
ALTER TABLE public.youtube_connections ADD CONSTRAINT youtube_connections_pkey PRIMARY KEY (id);
ALTER TABLE public.youtube_connections DROP CONSTRAINT IF EXISTS youtube_connections_profile_id_fkey;
ALTER TABLE public.youtube_connections ADD CONSTRAINT youtube_connections_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
ALTER TABLE public.youtube_connections DROP CONSTRAINT IF EXISTS youtube_connections_org_id_fkey;
ALTER TABLE public.youtube_connections ADD CONSTRAINT youtube_connections_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;
ALTER TABLE public.youtube_connections DROP CONSTRAINT IF EXISTS youtube_connections_connected_by_user_id_fkey;
ALTER TABLE public.youtube_connections ADD CONSTRAINT youtube_connections_connected_by_user_id_fkey FOREIGN KEY (connected_by_user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;

-- One connection per owner.
CREATE UNIQUE INDEX IF NOT EXISTS youtube_connections_profile_uidx ON public.youtube_connections (profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS youtube_connections_org_uidx ON public.youtube_connections (org_id) WHERE org_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS youtube_connections_profile_id_idx ON public.youtube_connections (profile_id);
CREATE INDEX IF NOT EXISTS youtube_connections_org_id_idx ON public.youtube_connections (org_id);
CREATE INDEX IF NOT EXISTS youtube_connections_connected_by_user_id_idx ON public.youtube_connections (connected_by_user_id);

DROP TRIGGER IF EXISTS youtube_connections_updated_at ON public.youtube_connections;
CREATE TRIGGER youtube_connections_updated_at BEFORE UPDATE ON public.youtube_connections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.youtube_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.youtube_connections FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.youtube_connections TO service_role;
COMMENT ON TABLE public.youtube_connections IS 'A YouTube channel connected to a profile XOR an org (298): the connector''s Google grant (connected_by_user_id — only they upload), the channel, the incremental scopes, the sealed tokens. One per owner. Posture A; the one writer is src/lib/videos/youtube-connections-server.ts.';

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (298, '298_youtube_connections.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 298 APPLIED | 1 | false | 298
SELECT '298 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'youtube_connections') AS tables_expect_1,
       has_table_privilege('anon', 'public.youtube_connections', 'SELECT') AS anon_expect_false,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_298;
