-- ============================================================================
-- Migration 088 — Drop the legacy get_tagged_posts(uuid) overload
-- ============================================================================
-- Found Aug 19 2026 by the black-box grant-posture re-verification (the
-- follow-up the diagnostic prescribes after any new RPC — 087 added four).
-- Every sensitive RPC probed BLOCKED for anon+authenticated, but probing
-- get_tagged_posts surfaced that TWO overloads are live:
--
--   get_tagged_posts(target_profile_id uuid)                        <- legacy
--   get_tagged_posts(target_profile_id uuid, current_user_id uuid,
--                    page_limit integer, page_offset integer)       <- 008
--
-- The 4-arg one is canonical (migration 008) and verified blocked. The 1-arg
-- one is from the ARCHIVED script era — fix-function-search-paths*.sql pins
-- `get_tagged_posts(UUID)` by that exact signature — and three facts make it
-- cruft worth removing rather than keeping:
--
--   1. 040's revoke keyed the 4-ARG signature, so the 1-arg overload's
--      EXECUTE grant was never revoked (pg default: PUBLIC can execute).
--   2. 083's repin loop keys on proname alone, so it set
--      search_path='public' on BOTH overloads — reviving whatever the
--      legacy body does (it predates the privacy-aware 008 rewrite).
--   3. The pair breaks PostgREST overload resolution: ANY rpc call passing
--      only target_profile_id gets HTTP 300 PGRST203 (ambiguous), for every
--      role including service_role. Dropping the legacy overload fixes that.
--
-- Exposure while live: none via the API surface — the ambiguity that breaks
-- resolution also means PostgREST could never route a call TO the 1-arg
-- overload (its only reachable arg-set collides with the 4-arg's defaults).
-- Reachable from SQL only, which the anon key does not have. So: latent, not
-- a leak — but latent + unrevoked + unowned body is exactly the archived-
-- hot-fix pattern that has already caused four incidents (025/036/037/081).
--
-- WHY DROP IS SAFE: src/ has ZERO callers of get_tagged_posts (any overload)
-- — the tagged tab reads through get_profile_tagged_media / _summary
-- (migration 066). The only callers anywhere are 082/083's verification
-- blocks, which call the 4-arg form positionally. Nothing can miss the 1-arg.
-- ============================================================================

DROP FUNCTION IF EXISTS public.get_tagged_posts(uuid);

-- ============================================================================
-- VERIFICATION — non-aborting (083's convention: a failed check must not
-- roll back the drop above; the SQL editor runs this file as ONE transaction).
-- ============================================================================
DO $$
DECLARE
  r          RECORD;
  v_count    INTEGER := 0;
  v_leftover TEXT := '';
BEGIN
  BEGIN
    FOR r IN
      SELECT p.proname,
             pg_get_function_identity_arguments(p.oid) AS args,
             (has_function_privilege('anon',          p.oid, 'EXECUTE')
           OR has_function_privilege('authenticated', p.oid, 'EXECUTE')) AS browser_can_execute
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'get_tagged_posts'
    LOOP
      v_count := v_count + 1;
      IF r.browser_can_execute THEN
        v_leftover := v_leftover || r.proname || '(' || r.args || ') ';
      END IF;
    END LOOP;

    IF v_count <> 1 THEN
      RAISE WARNING '088 CHECK FAILED: expected exactly 1 get_tagged_posts overload, found % — the drop above is still committed', v_count;
    ELSIF v_leftover <> '' THEN
      RAISE WARNING '088 CHECK FAILED: still executable by anon/authenticated: %', v_leftover;
    ELSE
      RAISE NOTICE '088 OK — one overload remains (the 4-arg canonical), browser keys blocked';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '088 CHECK FAILED: % [%]', SQLERRM, SQLSTATE;
  END;
END $$;

-- Re-runnable check grid (paste any time): expect ONE row, both grants false.
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS args,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon_can_execute,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authed_can_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public' AND p.proname = 'get_tagged_posts';
