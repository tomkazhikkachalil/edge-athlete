-- ============================================================================
-- 247: activity connections — a watch or an app connected ONCE in Settings,
--      and the sources an activity may now come from (additive; runs on BOTH
--      staging and prod; the code degrades by name until it has)
-- ============================================================================
-- Tom (Oct 1 2026): "You're supposed to connect permanently so anything you
-- do with your smart watch will then populate on the app … you connect to the
-- applications in settings." 245 made an activity one normalized row whatever
-- recorded it; this file adds WHO DELIVERS IT. It is this part's ONLY DDL:
--
--   1. activity_connections — ONE row per athlete per source.
--        provider   what is connected. 'upload_link' is the athlete's
--                   personal upload link (the Apple Watch path: a bridge app
--                   on the iPhone posts each workout to it); the rest are
--                   providers reached over OAuth, each added to the app only
--                   when its programme admits us (polar first).
--        status     active | revoked (the provider told us the athlete
--                   withdrew consent) | error (the last sync failed —
--                   last_error says why, in our words, never a token).
--        provider_user_id  the provider's id for the athlete — how a webhook
--                   finds the row.
--        secret_ciphertext  the OAuth tokens, encrypted by the app
--                   (AES-256-GCM, src/lib/crypto/secret-box-server.ts) —
--                   the database never holds a usable token.
--        token_hash  the upload link's token, sha256 (the calendar feed
--                   token's shape: the raw token is shown once and is
--                   unrecoverable; rotating replaces the hash).
--      Disconnecting DELETES the row; the activities it delivered stay —
--      they are the athlete's.
--      Posture A: RLS on, no policies, service role only — the projection
--      in src/lib/activities/connections.ts IS the access rule (never the
--      ciphertext, never the hash, in any response).
--   2. activities.source widens from ('file') to every way an activity can
--      arrive. The list is ACTIVITY_SOURCES in src/lib/activities/catalog.ts
--      (a test pins the two equal); naming a provider here does not connect
--      it — it lets its adapter write when it exists.
--
-- The table is created EMPTY, so its indexes are inline (MIGRATIONS "Large-
-- table indexes"). FKs, the primary key and the uniques are named ALTERs so
-- the schema parser sees them (live-schema.ts only reads named constraints).
--
-- REVERSAL: DROP TABLE public.activity_connections; put
-- activities_source_check back to (source IN ('file')) once no row holds
-- another source. Re-runnable until the ledger row lands; a second run stops
-- in the pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 247) THEN
    RAISE EXCEPTION '247 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 246 THEN RAISE EXCEPTION '247 pre-flight: ledger head is %, expected 246', n; END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activities') THEN
    RAISE EXCEPTION '247 pre-flight: public.activities is missing — 245 has not run here';
  END IF;
END $$;

-- ── 1. activity_connections ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_connections (
  id                 uuid        NOT NULL DEFAULT gen_random_uuid(),
  profile_id         uuid        NOT NULL,
  provider           text        NOT NULL CONSTRAINT activity_connections_provider_check
                                 CHECK (provider IN ('upload_link', 'polar', 'wahoo', 'coros', 'suunto', 'garmin', 'google_health')),
  status             text        NOT NULL DEFAULT 'active' CONSTRAINT activity_connections_status_check
                                 CHECK (status IN ('active', 'revoked', 'error')),
  provider_user_id   text        CONSTRAINT activity_connections_provider_user_check
                                 CHECK (provider_user_id IS NULL OR length(provider_user_id) BETWEEN 1 AND 200),
  secret_ciphertext  text        CONSTRAINT activity_connections_secret_check
                                 CHECK (secret_ciphertext IS NULL OR length(secret_ciphertext) BETWEEN 1 AND 8000),
  token_hash         text        CONSTRAINT activity_connections_token_hash_check
                                 CHECK (token_hash IS NULL OR token_hash ~ '^[0-9a-f]{64}$'),
  connected_at       timestamptz NOT NULL DEFAULT timezone('utc', now()),
  last_sync_at       timestamptz,
  last_error         text        CONSTRAINT activity_connections_last_error_check
                                 CHECK (last_error IS NULL OR length(last_error) BETWEEN 1 AND 300),
  created_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  updated_at         timestamptz NOT NULL DEFAULT timezone('utc', now()),
  -- An upload link IS its token and holds no provider secret; a provider
  -- connection never has a link token, and an ACTIVE one always has its secret.
  CONSTRAINT activity_connections_parts_check CHECK (
    CASE WHEN provider = 'upload_link'
         THEN token_hash IS NOT NULL AND secret_ciphertext IS NULL AND provider_user_id IS NULL
         ELSE token_hash IS NULL AND (status <> 'active' OR secret_ciphertext IS NOT NULL)
    END
  )
);
ALTER TABLE public.activity_connections DROP CONSTRAINT IF EXISTS activity_connections_pkey;
ALTER TABLE public.activity_connections ADD CONSTRAINT activity_connections_pkey PRIMARY KEY (id);
-- One connection per source per athlete; profile_id leads, so it is also the FK's index.
ALTER TABLE public.activity_connections DROP CONSTRAINT IF EXISTS activity_connections_profile_provider_uniq;
ALTER TABLE public.activity_connections ADD CONSTRAINT activity_connections_profile_provider_uniq UNIQUE (profile_id, provider);
ALTER TABLE public.activity_connections DROP CONSTRAINT IF EXISTS activity_connections_profile_id_fkey;
ALTER TABLE public.activity_connections ADD CONSTRAINT activity_connections_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
-- The upload link's lookup: the inbound route finds the row by the hash alone.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_connections_token_hash ON public.activity_connections (token_hash) WHERE token_hash IS NOT NULL;
-- A provider's webhook finds the athlete by the provider's own id; one
-- provider account feeds ONE athlete here.
CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_connections_provider_user ON public.activity_connections (provider, provider_user_id) WHERE provider_user_id IS NOT NULL;
DROP TRIGGER IF EXISTS activity_connections_updated_at ON public.activity_connections;
CREATE TRIGGER activity_connections_updated_at
  BEFORE UPDATE ON public.activity_connections
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
ALTER TABLE public.activity_connections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.activity_connections FROM PUBLIC, anon, authenticated;
COMMENT ON TABLE public.activity_connections IS 'Connected watches and apps (247): one row per athlete per source. ONE writer: src/lib/activities/connections-server.ts. secret_ciphertext is app-encrypted OAuth tokens; token_hash is the personal upload link (sha256). Posture A: service role only — no response ever carries either column.';

-- ── 2. activities.source: every way an activity can arrive ──────────────────
ALTER TABLE public.activities DROP CONSTRAINT IF EXISTS activities_source_check;
ALTER TABLE public.activities ADD CONSTRAINT activities_source_check
  CHECK (source IN ('file', 'upload_link', 'polar', 'wahoo', 'coros', 'suunto', 'garmin', 'google_health'));

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (247, '247_activity_connections.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 247 APPLIED | 1 | 1 | 0 | 8 | 247
SELECT '247 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'activity_connections') AS table_expect_1,
       (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public' AND c.relname = 'activity_connections' AND c.relrowsecurity) AS rls_on_expect_1,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = 'activity_connections') AS policies_expect_0,
       (SELECT count(*) FROM regexp_matches(
          (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'activities_source_check' AND conrelid = 'public.activities'::regclass),
          '''[a-z_]+''', 'g')) AS sources_expect_8,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_247;
