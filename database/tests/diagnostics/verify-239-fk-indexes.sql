-- ============================================================================
-- Verify migration 239 (every foreign key gets its index)
-- ============================================================================
-- READ ONLY, runnable before 239 (row 1 reads 83, row 2 reads 0) and after
-- (0 / 82). Row 1 is the standing check: any foreign key in schema public
-- without a leading index — a migration that added one without its index.
-- ============================================================================

SELECT '0 file' AS check_name, 'verify-239-fk-indexes.sql' AS expected, 'verify-239-fk-indexes.sql' AS actual, 'OK' AS status

UNION ALL

SELECT 'foreign keys without a leading index', '0', count(*)::text,
       CASE WHEN count(*) = 0 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_constraint c JOIN pg_namespace ns ON ns.oid = c.connamespace
 WHERE c.contype = 'f' AND ns.nspname = 'public'
   AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid
                     AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey::int2[])

UNION ALL

SELECT 'the 82 indexes of 239 exist', '82', count(*)::text,
       CASE WHEN count(*) = 82 THEN 'OK' ELSE 'CHECK FAILED' END
  FROM pg_indexes WHERE schemaname = 'public' AND indexname IN (
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
  );
