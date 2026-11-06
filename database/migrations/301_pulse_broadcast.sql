-- ============================================================================
-- 301: the pulse's change SIGNALS — the database broadcasts through Realtime
--      (realtime.send) when something the header shows has changed, so the
--      Live dot and the message badge move in about a second and the
--      per-tab poll becomes a 10-minute safety net (the cost program PR C,
--      Nov 6 2026; docs/specs/pulse.md). Runs on BOTH staging and prod
--      BEFORE the code deploys: a client joining its private topic before
--      the policy exists gets CHANNEL_ERROR and retries every 3 s.
-- ============================================================================
-- Two topics, no publication change, no new postgres_changes (WAL decoding
-- is the database's heaviest statement — SCALE_AUDIT):
--
--   live-now      PUBLIC. A golf round, a sport event, an event round or a
--                 broadcast enters or leaves "live". Payload {kind, at} and
--                 nothing else — who may see what stays server-side, every
--                 client answers the signal by fetching its OWN pulse.
--   user:{uuid}   PRIVATE (a realtime.messages SELECT policy: the topic is
--                 the viewer's own id). A message arrived in a conversation
--                 the person is in (the sender and muted participants
--                 included — closes the other-device and muted gaps the
--                 bell has), a conversation was read (on any device), the
--                 person's own seat on a live private round changed.
--
-- A signal must NEVER fail the write that caused it: pulse_send wraps
-- realtime.send in its own exception block (realtime.send logs its own
-- failures too). Payloads carry no personal data. Soft-deleted messages,
-- holds and leaves are left to the 10-minute net, by decision.
--
-- Reversal: DROP TRIGGER pulse_* on the seven tables, DROP FUNCTION
-- public.pulse_send and the six pulse_signal_* functions, DROP POLICY
-- "pulse: own user topic" ON realtime.messages.
-- ============================================================================

-- ── 0. Pre-flight ───────────────────────────────────────────────────────────
DO $$
DECLARE n int;
BEGIN
  IF EXISTS (SELECT 1 FROM public.schema_migrations WHERE number = 301) THEN
    RAISE EXCEPTION '301 has already run here — nothing to do';
  END IF;
  SELECT max(number) INTO n FROM public.schema_migrations;
  IF n < 300 THEN RAISE EXCEPTION '301 pre-flight: ledger head is %, expected 300', n; END IF;
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN
    RAISE EXCEPTION '301 pre-flight: realtime.send(jsonb,text,text,boolean) is missing — this project''s Realtime does not broadcast from SQL';
  END IF;
  IF to_regprocedure('realtime.topic()') IS NULL THEN
    RAISE EXCEPTION '301 pre-flight: realtime.topic() is missing — private channels cannot be authorized';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'videos' AND column_name = 'live_status') THEN
    RAISE EXCEPTION '301 pre-flight: videos.live_status is missing — 299 has not run here';
  END IF;
END $$;

-- ── 1. The policy: a person may read broadcasts on their own topic ──────────
-- (RLS is already on realtime.messages — Supabase owns the table; a policy is ours to add.)
DROP POLICY IF EXISTS "pulse: own user topic" ON realtime.messages;
CREATE POLICY "pulse: own user topic" ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.topic() = 'user:' || (SELECT auth.uid())::text AND extension = 'broadcast');

-- ── 2. The one sender: never fails the write ────────────────────────────────
CREATE OR REPLACE FUNCTION public.pulse_send(p_topic text, p_payload jsonb, p_private boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM realtime.send(p_payload || jsonb_build_object('at', extract(epoch FROM now())), 'pulse', p_topic, p_private);
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'pulse_send(%): %', p_topic, SQLERRM;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.pulse_send(text, jsonb, boolean) FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.pulse_send(text, jsonb, boolean) IS
  'The pulse signal (301): one realtime.send on the given topic, event ''pulse'', the payload plus ''at''. Swallows every error — a signal never fails a write. Called by the pulse_signal_* triggers only.';

-- ── 3. live-now (public): golf rounds ───────────────────────────────────────
-- A golf round is "live" to the pulse while pending | active (me_pulse's
-- rule, 292). Any insert, delete or status / visibility / date change that
-- touches a live row is a signal.
CREATE OR REPLACE FUNCTION public.pulse_signal_golf()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND OLD.type = 'golf_round' AND OLD.status IN ('pending', 'active');
  new_live boolean := (TG_OP <> 'DELETE') AND NEW.type = 'golf_round' AND NEW.status IN ('pending', 'active');
BEGIN
  IF old_live OR new_live THEN
    PERFORM public.pulse_send('live-now', jsonb_build_object('kind', 'golf'), false);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_golf ON public.group_posts;
CREATE TRIGGER pulse_golf
  AFTER INSERT OR DELETE OR UPDATE OF status, visibility, date ON public.group_posts
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_golf();

-- ── 4. live-now (public): sport events and their rounds ─────────────────────
-- An event counts while status = 'live' AND a round is 'live' (292): a
-- change on either side that enters or leaves 'live' is a signal.
CREATE OR REPLACE FUNCTION public.pulse_signal_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND (OLD.status = 'live' OR NEW.status = 'live') THEN
    PERFORM public.pulse_send('live-now', jsonb_build_object('kind', 'event'), false);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_event ON public.sport_events;
CREATE TRIGGER pulse_event
  AFTER UPDATE OF status ON public.sport_events
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_event();
DROP TRIGGER IF EXISTS pulse_event_round ON public.sport_event_rounds;
CREATE TRIGGER pulse_event_round
  AFTER UPDATE OF status ON public.sport_event_rounds
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_event();

-- ── 5. live-now (public): broadcasts ────────────────────────────────────────
-- A broadcast counts while live_status = 'live' AND status = 'published' (300).
CREATE OR REPLACE FUNCTION public.pulse_signal_broadcast()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  old_live boolean := (TG_OP <> 'INSERT') AND OLD.live_status = 'live' AND OLD.status = 'published';
  new_live boolean := (TG_OP <> 'DELETE') AND NEW.live_status = 'live' AND NEW.status = 'published';
BEGIN
  IF old_live <> new_live THEN
    PERFORM public.pulse_send('live-now', jsonb_build_object('kind', 'broadcast'), false);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_broadcast ON public.videos;
CREATE TRIGGER pulse_broadcast
  AFTER INSERT OR DELETE OR UPDATE OF live_status, status ON public.videos
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_broadcast();

-- ── 6. user:{id} (private): a message arrived ───────────────────────────────
-- Every active, unheld participant — the SENDER included (their other
-- devices) and muted participants (the bell skips them; the count does not).
CREATE OR REPLACE FUNCTION public.pulse_signal_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT cp.profile_id
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = NEW.conversation_id
      AND cp.left_at IS NULL
      AND cp.held_at IS NULL
  LOOP
    PERFORM public.pulse_send('user:' || r.profile_id::text, jsonb_build_object('kind', 'messages', 'conversation_id', NEW.conversation_id), true);
  END LOOP;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_message ON public.messages;
CREATE TRIGGER pulse_message
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_message();

-- ── 7. user:{id} (private): a conversation was read ─────────────────────────
CREATE OR REPLACE FUNCTION public.pulse_signal_read()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF OLD.last_read_at IS DISTINCT FROM NEW.last_read_at THEN
    PERFORM public.pulse_send('user:' || NEW.profile_id::text, jsonb_build_object('kind', 'messages', 'conversation_id', NEW.conversation_id), true);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_read ON public.conversation_participants;
CREATE TRIGGER pulse_read
  AFTER UPDATE OF last_read_at ON public.conversation_participants
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_read();

-- ── 8. user:{id} (private): my seat on a live private round changed ─────────
-- The viewer's count depends on their own roster row (292: any status but
-- declined). Added, removed, or moved to / from declined on a round that is
-- live right now → that one person's signal.
CREATE OR REPLACE FUNCTION public.pulse_signal_roster()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  who uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.profile_id ELSE NEW.profile_id END;
  round_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.group_post_id ELSE NEW.group_post_id END;
  changed boolean := TG_OP <> 'UPDATE' OR (OLD.status IS DISTINCT FROM NEW.status AND (OLD.status = 'declined' OR NEW.status = 'declined'));
BEGIN
  IF changed AND EXISTS (
    SELECT 1 FROM public.group_posts gp
    WHERE gp.id = round_id AND gp.type = 'golf_round' AND gp.status IN ('pending', 'active')
  ) THEN
    PERFORM public.pulse_send('user:' || who::text, jsonb_build_object('kind', 'live'), true);
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS pulse_roster ON public.group_post_participants;
CREATE TRIGGER pulse_roster
  AFTER INSERT OR DELETE OR UPDATE OF status ON public.group_post_participants
  FOR EACH ROW EXECUTE FUNCTION public.pulse_signal_roster();

NOTIFY pgrst, 'reload schema';

-- ── The footer: this file records itself in the ledger (226) ────────────────
INSERT INTO public.schema_migrations (number, name) VALUES (301, '301_pulse_broadcast.sql') ON CONFLICT (number) DO NOTHING;

-- Expected on both: 301 APPLIED | 7 | 1 | 301
SELECT '301 APPLIED' AS result,
       (SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'pulse\_%' AND NOT tgisinternal) AS triggers_expect_7,
       (SELECT count(*) FROM pg_policies WHERE schemaname = 'realtime' AND tablename = 'messages' AND policyname = 'pulse: own user topic') AS policy_expect_1,
       (SELECT max(number) FROM public.schema_migrations) AS ledger_head_expect_301;
