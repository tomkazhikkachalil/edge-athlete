-- ============================================================================
-- 239: every foreign key gets its index — the 83 foreign keys without a
--      leading index, 82 indexes (merges ALONE; additive, runs any time
--      after 238)
-- ============================================================================
-- The departed-accounts round (Sep 25 2026) measured ONE profile DELETE on
-- staging at 13.9 s (EXPLAIN ANALYZE): Postgres checks every table that
-- references the row, and where the referencing column has no index the RI
-- trigger scans the whole table — contest_stat_lines.entered_by 4.8 s,
-- tickets.assignee_profile_id 1.2 s, and so on down the list. That cost is
-- paid by the deletion engine's erase path, the daily purge (50 accounts in
-- a 60 s function), every SET NULL / CASCADE through these columns, and the
-- QA teardown (which hit staging's statement timeout twice). It grows with
-- the data.
--
-- A read-only catalog query (staging, identical to prod at 238) found 83
-- foreign keys in schema public without a leading index: 50 reference
-- profiles(id) (the deletion path), 33 reference tickets, places,
-- facilities, teams, posts, divisions, programs, seasons and the rest (every
-- SET NULL / CASCADE through them scans the child table the same way). This
-- file indexes all 83 with 82 indexes — contests' composite
-- (facility_id, venue_id) index also leads its single-column facility FK —
-- and src/lib/__tests__/fk-index-coverage.test.ts keeps the class closed (an
-- FK added without its leading index fails `npm run verify`). (The first
-- read of this list said 50: scripts/staging-sql.mjs prints 50 rows — the
-- list is now read as one aggregated row.)
--
-- Plain B-trees on exactly the FK's columns: they serve the RI trigger's `col = $1` probe
-- with no dependence on the planner proving a partial predicate; the tables
-- are small, so the NULL entries cost nothing that matters. NOT CONCURRENTLY:
-- the Supabase SQL editor runs this file as ONE transaction, where
-- CONCURRENTLY is refused — and prod's tables hold hundreds of rows, so each
-- build's lock lasts milliseconds. At scale, a new FK index ships
-- CONCURRENTLY from a script, never through the editor. The names were
-- checked against the 319 existing indexes (IF NOT EXISTS would skip a
-- clashing name silently) and all fit in 63 characters.
--
-- REVERSAL: `DROP INDEX public.<name>` for any of the 50; nothing else
-- changes. Re-runnable until the ledger row lands; a second run stops in the
-- pre-flight.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 239) THEN
    RAISE EXCEPTION '239 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 238 THEN RAISE EXCEPTION '239 pre-flight: ledger head is %, expected 238', n; END IF;
END $$;

-- ── 1. The 82 indexes, by table ─────────────────────────────────────────────
-- affiliations
CREATE INDEX IF NOT EXISTS idx_affiliations_decided_by_profile_id ON public.affiliations (decided_by_profile_id);
CREATE INDEX IF NOT EXISTS idx_affiliations_requested_by_profile_id ON public.affiliations (requested_by_profile_id);

-- approved_contacts
CREATE INDEX IF NOT EXISTS idx_approved_contacts_contact_profile_id ON public.approved_contacts (contact_profile_id);
CREATE INDEX IF NOT EXISTS idx_approved_contacts_decided_by ON public.approved_contacts (decided_by);

-- athlete_claim_invites
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_consumed_by ON public.athlete_claim_invites (consumed_by);
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_created_by ON public.athlete_claim_invites (created_by);
CREATE INDEX IF NOT EXISTS idx_athlete_claim_invites_team_id ON public.athlete_claim_invites (team_id);

-- athlete_performances
CREATE INDEX IF NOT EXISTS idx_athlete_performances_contest_id ON public.athlete_performances (contest_id);
CREATE INDEX IF NOT EXISTS idx_athlete_performances_entered_by ON public.athlete_performances (entered_by);

-- competition_entries
CREATE INDEX IF NOT EXISTS idx_competition_entries_affiliation_team_id ON public.competition_entries (affiliation_team_id);

-- competition_standings
CREATE INDEX IF NOT EXISTS idx_competition_standings_entry_id ON public.competition_standings (entry_id);

-- consent_records
CREATE INDEX IF NOT EXISTS idx_consent_records_guardian_user_id ON public.consent_records (guardian_user_id);

-- contest_media
CREATE INDEX IF NOT EXISTS idx_contest_media_uploaded_by ON public.contest_media (uploaded_by);

-- contest_media_tags
CREATE INDEX IF NOT EXISTS idx_contest_media_tags_tagged_by ON public.contest_media_tags (tagged_by);

-- contest_results
CREATE INDEX IF NOT EXISTS idx_contest_results_confirmed_by ON public.contest_results (confirmed_by);
CREATE INDEX IF NOT EXISTS idx_contest_results_disputed_by ON public.contest_results (disputed_by);
CREATE INDEX IF NOT EXISTS idx_contest_results_entered_by ON public.contest_results (entered_by);
CREATE INDEX IF NOT EXISTS idx_contest_results_resolved_by ON public.contest_results (resolved_by);

-- contest_stat_lines
CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_entered_by ON public.contest_stat_lines (entered_by);
CREATE INDEX IF NOT EXISTS idx_contest_stat_lines_team_id ON public.contest_stat_lines (team_id);

-- contests
CREATE INDEX IF NOT EXISTS idx_contests_facility_id_venue_id ON public.contests (facility_id, venue_id);
CREATE INDEX IF NOT EXISTS idx_contests_venue_id ON public.contests (venue_id);

-- conversations
CREATE INDEX IF NOT EXISTS idx_conversations_created_by ON public.conversations (created_by);
CREATE INDEX IF NOT EXISTS idx_conversations_frozen_ticket_id ON public.conversations (frozen_ticket_id);

-- event_carpool_claims
CREATE INDEX IF NOT EXISTS idx_event_carpool_claims_rider_profile_id ON public.event_carpool_claims (rider_profile_id);

-- event_carpool_offers
CREATE INDEX IF NOT EXISTS idx_event_carpool_offers_driver_profile_id ON public.event_carpool_offers (driver_profile_id);

-- event_series
CREATE INDEX IF NOT EXISTS idx_event_series_organizer_id ON public.event_series (organizer_id);

-- events
CREATE INDEX IF NOT EXISTS idx_events_facility_id_venue_id ON public.events (facility_id, venue_id);

-- golf_clubs
CREATE INDEX IF NOT EXISTS idx_golf_clubs_place_id ON public.golf_clubs (place_id);

-- golf_participant_scores
CREATE INDEX IF NOT EXISTS idx_golf_participant_scores_finalized_by ON public.golf_participant_scores (finalized_by);

-- guardian_invites
CREATE INDEX IF NOT EXISTS idx_guardian_invites_created_by ON public.guardian_invites (created_by);
CREATE INDEX IF NOT EXISTS idx_guardian_invites_pending_profile_id ON public.guardian_invites (pending_profile_id);
CREATE INDEX IF NOT EXISTS idx_guardian_invites_profile_id ON public.guardian_invites (profile_id);

-- help_articles
CREATE INDEX IF NOT EXISTS idx_help_articles_created_by ON public.help_articles (created_by);
CREATE INDEX IF NOT EXISTS idx_help_articles_updated_by ON public.help_articles (updated_by);

-- memberships
CREATE INDEX IF NOT EXISTS idx_memberships_granted_by ON public.memberships (granted_by);
CREATE INDEX IF NOT EXISTS idx_memberships_photo_consent_by ON public.memberships (photo_consent_by);

-- message_reactions
CREATE INDEX IF NOT EXISTS idx_message_reactions_profile_id ON public.message_reactions (profile_id);

-- message_reports
CREATE INDEX IF NOT EXISTS idx_message_reports_conversation_id ON public.message_reports (conversation_id);
CREATE INDEX IF NOT EXISTS idx_message_reports_message_id ON public.message_reports (message_id);

-- messages
CREATE INDEX IF NOT EXISTS idx_messages_shared_post_id ON public.messages (shared_post_id);
CREATE INDEX IF NOT EXISTS idx_messages_shared_profile_id ON public.messages (shared_profile_id);

-- org_claim_invites
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_consumed_by ON public.org_claim_invites (consumed_by);
CREATE INDEX IF NOT EXISTS idx_org_claim_invites_created_by ON public.org_claim_invites (created_by);

-- org_join_requests
CREATE INDEX IF NOT EXISTS idx_org_join_requests_profile_id ON public.org_join_requests (profile_id);

-- org_requests
CREATE INDEX IF NOT EXISTS idx_org_requests_created_org_id ON public.org_requests (created_org_id);
CREATE INDEX IF NOT EXISTS idx_org_requests_place_id ON public.org_requests (place_id);
CREATE INDEX IF NOT EXISTS idx_org_requests_reviewed_by ON public.org_requests (reviewed_by);

-- org_site_revisions
CREATE INDEX IF NOT EXISTS idx_org_site_revisions_created_by ON public.org_site_revisions (created_by);
CREATE INDEX IF NOT EXISTS idx_org_site_revisions_published_by ON public.org_site_revisions (published_by);

-- org_sites
CREATE INDEX IF NOT EXISTS idx_org_sites_draft_revision_id ON public.org_sites (draft_revision_id);
CREATE INDEX IF NOT EXISTS idx_org_sites_published_revision_id ON public.org_sites (published_revision_id);

-- org_staff_invites
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_consumed_by ON public.org_staff_invites (consumed_by);
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_created_by ON public.org_staff_invites (created_by);
CREATE INDEX IF NOT EXISTS idx_org_staff_invites_season_id ON public.org_staff_invites (season_id);

-- pending_profiles
CREATE INDEX IF NOT EXISTS idx_pending_profiles_promoted_profile_id ON public.pending_profiles (promoted_profile_id);

-- platform_admins
CREATE INDEX IF NOT EXISTS idx_platform_admins_granted_by ON public.platform_admins (granted_by);

-- post_comments
CREATE INDEX IF NOT EXISTS idx_post_comments_hidden_ticket_id ON public.post_comments (hidden_ticket_id);

-- posts
CREATE INDEX IF NOT EXISTS idx_posts_hidden_ticket_id ON public.posts (hidden_ticket_id);

-- profile_access
CREATE INDEX IF NOT EXISTS idx_profile_access_granted_by ON public.profile_access (granted_by);

-- profile_transfers
CREATE INDEX IF NOT EXISTS idx_profile_transfers_initiator_user_id ON public.profile_transfers (initiator_user_id);

-- profiles
CREATE INDEX IF NOT EXISTS idx_profiles_moderation_ticket_id ON public.profiles (moderation_ticket_id);

-- registration_windows
CREATE INDEX IF NOT EXISTS idx_registration_windows_created_by ON public.registration_windows (created_by);
CREATE INDEX IF NOT EXISTS idx_registration_windows_division_id ON public.registration_windows (division_id);
CREATE INDEX IF NOT EXISTS idx_registration_windows_program_id ON public.registration_windows (program_id);

-- registrations
CREATE INDEX IF NOT EXISTS idx_registrations_division_id ON public.registrations (division_id);
CREATE INDEX IF NOT EXISTS idx_registrations_program_id ON public.registrations (program_id);
CREATE INDEX IF NOT EXISTS idx_registrations_released_by ON public.registrations (released_by);
CREATE INDEX IF NOT EXISTS idx_registrations_submitted_by ON public.registrations (submitted_by);

-- search_documents
CREATE INDEX IF NOT EXISTS idx_search_documents_place_id ON public.search_documents (place_id);

-- sport_event_group_members
CREATE INDEX IF NOT EXISTS idx_sport_event_group_members_participant_id ON public.sport_event_group_members (participant_id);

-- sport_event_media
CREATE INDEX IF NOT EXISTS idx_sport_event_media_created_by_user_id ON public.sport_event_media (created_by_user_id);

-- sport_event_participants
CREATE INDEX IF NOT EXISTS idx_sport_event_participants_invited_by ON public.sport_event_participants (invited_by);

-- sport_event_stat_lines
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_entered_by ON public.sport_event_stat_lines (entered_by);
CREATE INDEX IF NOT EXISTS idx_sport_event_stat_lines_participant_id ON public.sport_event_stat_lines (participant_id);

-- sport_events
CREATE INDEX IF NOT EXISTS idx_sport_events_created_by_user_id ON public.sport_events (created_by_user_id);

-- ticket_events
CREATE INDEX IF NOT EXISTS idx_ticket_events_actor_profile_id ON public.ticket_events (actor_profile_id);

-- tickets
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_profile_id ON public.tickets (assignee_profile_id);
CREATE INDEX IF NOT EXISTS idx_tickets_merged_into_id ON public.tickets (merged_into_id);

-- user_mutes
CREATE INDEX IF NOT EXISTS idx_user_mutes_muted_id ON public.user_mutes (muted_id);

-- venues
CREATE INDEX IF NOT EXISTS idx_venues_place_id ON public.venues (place_id);

-- workout_sessions
CREATE INDEX IF NOT EXISTS idx_workout_sessions_post_id ON public.workout_sessions (post_id);

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (239, '239_fk_indexes.sql') ON CONFLICT (number) DO NOTHING;

-- ── Result (ONE row; the twin under tests/diagnostics/ is the grid) ─────────
-- Expected: 239 APPLIED | 82 | 0 | 239
SELECT '239 APPLIED' AS result,
       (SELECT count(*) FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
         'idx_affiliations_decided_by_profile_id',
         'idx_affiliations_requested_by_profile_id',
         'idx_approved_contacts_contact_profile_id',
         'idx_approved_contacts_decided_by',
         'idx_athlete_claim_invites_consumed_by',
         'idx_athlete_claim_invites_created_by',
         'idx_athlete_claim_invites_team_id',
         'idx_athlete_performances_contest_id',
         'idx_athlete_performances_entered_by',
         'idx_competition_entries_affiliation_team_id',
         'idx_competition_standings_entry_id',
         'idx_consent_records_guardian_user_id',
         'idx_contest_media_uploaded_by',
         'idx_contest_media_tags_tagged_by',
         'idx_contest_results_confirmed_by',
         'idx_contest_results_disputed_by',
         'idx_contest_results_entered_by',
         'idx_contest_results_resolved_by',
         'idx_contest_stat_lines_entered_by',
         'idx_contest_stat_lines_team_id',
         'idx_contests_facility_id_venue_id',
         'idx_contests_venue_id',
         'idx_conversations_created_by',
         'idx_conversations_frozen_ticket_id',
         'idx_event_carpool_claims_rider_profile_id',
         'idx_event_carpool_offers_driver_profile_id',
         'idx_event_series_organizer_id',
         'idx_events_facility_id_venue_id',
         'idx_golf_clubs_place_id',
         'idx_golf_participant_scores_finalized_by',
         'idx_guardian_invites_created_by',
         'idx_guardian_invites_pending_profile_id',
         'idx_guardian_invites_profile_id',
         'idx_help_articles_created_by',
         'idx_help_articles_updated_by',
         'idx_memberships_granted_by',
         'idx_memberships_photo_consent_by',
         'idx_message_reactions_profile_id',
         'idx_message_reports_conversation_id',
         'idx_message_reports_message_id',
         'idx_messages_shared_post_id',
         'idx_messages_shared_profile_id',
         'idx_org_claim_invites_consumed_by',
         'idx_org_claim_invites_created_by',
         'idx_org_join_requests_profile_id',
         'idx_org_requests_created_org_id',
         'idx_org_requests_place_id',
         'idx_org_requests_reviewed_by',
         'idx_org_site_revisions_created_by',
         'idx_org_site_revisions_published_by',
         'idx_org_sites_draft_revision_id',
         'idx_org_sites_published_revision_id',
         'idx_org_staff_invites_consumed_by',
         'idx_org_staff_invites_created_by',
         'idx_org_staff_invites_season_id',
         'idx_pending_profiles_promoted_profile_id',
         'idx_platform_admins_granted_by',
         'idx_post_comments_hidden_ticket_id',
         'idx_posts_hidden_ticket_id',
         'idx_profile_access_granted_by',
         'idx_profile_transfers_initiator_user_id',
         'idx_profiles_moderation_ticket_id',
         'idx_registration_windows_created_by',
         'idx_registration_windows_division_id',
         'idx_registration_windows_program_id',
         'idx_registrations_division_id',
         'idx_registrations_program_id',
         'idx_registrations_released_by',
         'idx_registrations_submitted_by',
         'idx_search_documents_place_id',
         'idx_sport_event_group_members_participant_id',
         'idx_sport_event_media_created_by_user_id',
         'idx_sport_event_participants_invited_by',
         'idx_sport_event_stat_lines_entered_by',
         'idx_sport_event_stat_lines_participant_id',
         'idx_sport_events_created_by_user_id',
         'idx_ticket_events_actor_profile_id',
         'idx_tickets_assignee_profile_id',
         'idx_tickets_merged_into_id',
         'idx_user_mutes_muted_id',
         'idx_venues_place_id',
         'idx_workout_sessions_post_id'
       )) AS new_indexes_expect_82,
       (SELECT count(*) FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
         WHERE c.contype = 'f' AND ns.nspname = 'public'
           AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                             AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])) AS unindexed_fks_expect_0,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_239;
