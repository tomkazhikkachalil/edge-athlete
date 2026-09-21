-- ============================================================================
-- 225: Round 1 (safety + operability) — deletion-safe FKs, and the row-type
--      insert lesson applied to moderation_state
-- ============================================================================
-- Two findings of the Sep 19 assessment, one migration. Merges ALONE.
--
--   * Three attribution columns pointed at profiles with NO ON DELETE and
--     NOT NULL: contest_stat_lines.entered_by (157), contest_media.uploaded_by
--     and contest_media_tags.tagged_by (158). The deletion engine
--     (src/lib/account-deletion.ts) never touched them, so `DELETE FROM
--     profiles` answered 23503 for any user whose org had recorded a stat
--     line or a contest photo — a self-serve delete, a guardian's child
--     delete and the 30-day purge all hard-failed for them. Attribution
--     survives the person: the columns become nullable and the FKs SET NULL
--     (the record stays, its "who" reads as unknown), like every other
--     "entered by" column in the chain.
--   * profiles.moderation_state (223) was NOT NULL DEFAULT 'active' — and
--     create_managed_profile (053) inserts a WHOLE row through
--     jsonb_populate_record, so the unnamed column arrived as an explicit
--     NULL and adding a supervised athlete failed from the moment 223 ran
--     (the 175 / 179 / 182 class; 184 documents it). The route supplies the
--     column since Round 1 PR 1; this drops the NOT NULL as 184 did, so the
--     class cannot bite through any other whole-row writer. NULL reads as
--     active everywhere (`effectiveState`). The DEFAULT stays.
--
-- Every existing row keeps its values. Re-runnable.
-- ============================================================================

-- ── The three attribution FKs ───────────────────────────────────────────────
ALTER TABLE contest_stat_lines ALTER COLUMN entered_by DROP NOT NULL;
ALTER TABLE contest_stat_lines DROP CONSTRAINT IF EXISTS contest_stat_lines_entered_by_fkey;
ALTER TABLE contest_stat_lines ADD CONSTRAINT contest_stat_lines_entered_by_fkey
  FOREIGN KEY (entered_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE contest_media ALTER COLUMN uploaded_by DROP NOT NULL;
ALTER TABLE contest_media DROP CONSTRAINT IF EXISTS contest_media_uploaded_by_fkey;
ALTER TABLE contest_media ADD CONSTRAINT contest_media_uploaded_by_fkey
  FOREIGN KEY (uploaded_by) REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE contest_media_tags ALTER COLUMN tagged_by DROP NOT NULL;
ALTER TABLE contest_media_tags DROP CONSTRAINT IF EXISTS contest_media_tags_tagged_by_fkey;
ALTER TABLE contest_media_tags ADD CONSTRAINT contest_media_tags_tagged_by_fkey
  FOREIGN KEY (tagged_by) REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN contest_stat_lines.entered_by IS 'Who entered the line (225: nullable, SET NULL on their deletion — the record survives the person).';
COMMENT ON COLUMN contest_media.uploaded_by IS 'Who uploaded it (225: nullable, SET NULL on their deletion).';
COMMENT ON COLUMN contest_media_tags.tagged_by IS 'Who tagged (225: nullable, SET NULL on their deletion).';

-- ── moderation_state: the row-type insert lesson ────────────────────────────
ALTER TABLE profiles ALTER COLUMN moderation_state DROP NOT NULL;
ALTER TABLE profiles ALTER COLUMN moderation_state SET DEFAULT 'active';

NOTIFY pgrst, 'reload schema';

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 225 APPLIED | 3 | 3 | 1
SELECT '225 APPLIED' AS result,
       (SELECT count(*) FROM pg_constraint
         WHERE conname IN ('contest_stat_lines_entered_by_fkey', 'contest_media_uploaded_by_fkey', 'contest_media_tags_tagged_by_fkey')
           AND contype = 'f' AND confdeltype = 'n') AS set_null_fks_expect_3,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public'
           AND ((table_name = 'contest_stat_lines' AND column_name = 'entered_by')
             OR (table_name = 'contest_media' AND column_name = 'uploaded_by')
             OR (table_name = 'contest_media_tags' AND column_name = 'tagged_by'))
           AND is_nullable = 'YES') AS nullable_expect_3,
       (SELECT count(*) FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'moderation_state'
           AND is_nullable = 'YES' AND column_default LIKE '%active%') AS moderation_state_nullable_expect_1;
