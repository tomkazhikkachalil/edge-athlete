-- ============================================================================
-- 232: Round 5 (organizations unification), step B — `org_id` on the pair
--      tables, GENERATED from (league_id, club_id) (merges ALONE)
-- ============================================================================
-- 231 built `organizations` and mirrors leagues ∪ clubs into it by trigger.
-- This file gives every table that names an org through the nullable
-- (league_id, club_id) pair ONE column that names it outright:
--
--   org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED
--
-- The app keeps writing the pair; the generated column follows every write
-- for free, so the READS can switch to `org_id` one subsystem at a time
-- (code PR B1: `src/lib/orgs/org-ref.ts`) while every old reader stays
-- right. Step C makes it a real NOT NULL column and reverses the mirror;
-- step D drops the pair.
--
-- FIFTEEN tables, not the audit's sixteen: `league_clubs` carries BOTH
-- columns NOT NULL because it is an AFFILIATION (a league's member club),
-- not an org — it becomes `affiliations` in step D, never a COALESCE.
--
-- The FK → organizations is plain NO ACTION on purpose. A generated column
-- can't be the target of SET NULL (nothing may assign it), and CASCADE
-- would be wrong for the four SET NULL tables (events, sport_events,
-- venues, athlete_claim_invites). NO ACTION is correct in this window
-- because a delete still starts at leagues / clubs: PostgreSQL fires
-- AFTER triggers in name order, the RI cascades ("RI_ConstraintTrigger_…")
-- sort before "organizations_mirror_…", so the children are cascaded or
-- nulled BEFORE the mirror removes the organizations row, and the
-- end-of-statement check finds nothing dangling. `org_staff_audit` gets
-- the column and its index but NO FK: it is append-only under
-- `forbid_mutation` (178), so any referential action would make deleting
-- an org fail — the trail outlives the org, as it does today.
--
-- `golf_courses.club_id` → golf_clubs (the rename trap) is untouched.
-- Re-runnable.
-- ============================================================================

-- ── 1. The column, the FK, the index — one block per table ──────────────────
-- Fourteen with the FK; the partial index mirrors the pair's own where the
-- pair was partial (an org is optional on the SET NULL tables).

ALTER TABLE public.athlete_claim_invites ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.athlete_claim_invites DROP CONSTRAINT IF EXISTS athlete_claim_invites_org_id_fkey;
ALTER TABLE public.athlete_claim_invites ADD CONSTRAINT athlete_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_org ON public.athlete_claim_invites (org_id) WHERE org_id IS NOT NULL;

ALTER TABLE public.competitions ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.competitions DROP CONSTRAINT IF EXISTS competitions_org_id_fkey;
ALTER TABLE public.competitions ADD CONSTRAINT competitions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_competitions_org ON public.competitions (org_id);

ALTER TABLE public.divisions ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.divisions DROP CONSTRAINT IF EXISTS divisions_org_id_fkey;
ALTER TABLE public.divisions ADD CONSTRAINT divisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_divisions_org ON public.divisions (org_id);

ALTER TABLE public.events ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_org_id_fkey;
ALTER TABLE public.events ADD CONSTRAINT events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_events_org ON public.events (org_id) WHERE org_id IS NOT NULL;

ALTER TABLE public.memberships ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_org_id_fkey;
ALTER TABLE public.memberships ADD CONSTRAINT memberships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships (org_id);

ALTER TABLE public.org_claim_invites ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.org_claim_invites DROP CONSTRAINT IF EXISTS org_claim_invites_org_id_fkey;
ALTER TABLE public.org_claim_invites ADD CONSTRAINT org_claim_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_org ON public.org_claim_invites (org_id) WHERE consumed_at IS NULL;

ALTER TABLE public.org_sites ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.org_sites DROP CONSTRAINT IF EXISTS org_sites_org_id_fkey;
ALTER TABLE public.org_sites ADD CONSTRAINT org_sites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_org_sites_org ON public.org_sites (org_id);

ALTER TABLE public.org_staff_invites ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.org_staff_invites DROP CONSTRAINT IF EXISTS org_staff_invites_org_id_fkey;
ALTER TABLE public.org_staff_invites ADD CONSTRAINT org_staff_invites_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_org ON public.org_staff_invites (org_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;

ALTER TABLE public.registration_windows ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.registration_windows DROP CONSTRAINT IF EXISTS registration_windows_org_id_fkey;
ALTER TABLE public.registration_windows ADD CONSTRAINT registration_windows_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_registration_windows_org ON public.registration_windows (org_id);

ALTER TABLE public.registrations ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.registrations DROP CONSTRAINT IF EXISTS registrations_org_id_fkey;
ALTER TABLE public.registrations ADD CONSTRAINT registrations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_registrations_org ON public.registrations (org_id);

ALTER TABLE public.seasons ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.seasons DROP CONSTRAINT IF EXISTS seasons_org_id_fkey;
ALTER TABLE public.seasons ADD CONSTRAINT seasons_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_seasons_org ON public.seasons (org_id);

ALTER TABLE public.sport_events ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.sport_events DROP CONSTRAINT IF EXISTS sport_events_org_id_fkey;
ALTER TABLE public.sport_events ADD CONSTRAINT sport_events_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_sport_events_org ON public.sport_events (org_id) WHERE org_id IS NOT NULL;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_org_id_fkey;
ALTER TABLE public.teams ADD CONSTRAINT teams_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_teams_org ON public.teams (org_id);

ALTER TABLE public.venues ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
ALTER TABLE public.venues DROP CONSTRAINT IF EXISTS venues_org_id_fkey;
ALTER TABLE public.venues ADD CONSTRAINT venues_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id);
CREATE INDEX IF NOT EXISTS idx_venues_org ON public.venues (org_id) WHERE org_id IS NOT NULL;

-- ── 2. org_staff_audit: the column and the index, no FK (see the header) ────
ALTER TABLE public.org_staff_audit ADD COLUMN IF NOT EXISTS org_id uuid GENERATED ALWAYS AS (COALESCE(league_id, club_id)) STORED;
CREATE INDEX IF NOT EXISTS idx_org_staff_audit_org ON public.org_staff_audit (org_id, created_at DESC);

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (232, '232_org_id_generated.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 232 APPLIED | 15 | 14 | 0 | 232
SELECT '232 APPLIED' AS result,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND column_name = 'org_id' AND is_generated = 'ALWAYS') AS org_id_columns_expect_15,
       (SELECT count(*) FROM pg_constraint
         WHERE contype = 'f' AND conname LIKE '%\_org\_id\_fkey' AND confrelid = 'public.organizations'::regclass) AS fks_expect_14,
       (SELECT count(*) FROM public.teams t WHERE t.org_id IS DISTINCT FROM COALESCE(t.league_id, t.club_id))
       + (SELECT count(*) FROM public.memberships m WHERE m.org_id IS DISTINCT FROM COALESCE(m.league_id, m.club_id))
       + (SELECT count(*) FROM public.org_sites s WHERE s.org_id IS DISTINCT FROM COALESCE(s.league_id, s.club_id)) AS mismatches_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_232;
