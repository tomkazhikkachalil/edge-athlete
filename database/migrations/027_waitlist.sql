-- ============================================================================
-- Migration 027 — Waitlist table (the API was a no-op discarding every lead)
-- ============================================================================
-- The landing page routes 4 of its 5 CTAs (Club / League / Fan / Guest)
-- through POST /api/waitlist, whose persistence was commented out — every
-- interested lead was silently discarded. This creates the table the route
-- now writes to.
--
-- Security: RLS enabled with NO policies — reads/writes happen exclusively
-- through the service-role client in the API route. Anonymous and
-- authenticated clients cannot touch this table directly (it holds email
-- addresses of people who are not yet users).
--
-- ⚠️ Supabase SQL Editor. Run the WHOLE file; expect green "Success".
-- ============================================================================

CREATE TABLE IF NOT EXISTS waitlist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL,
  user_type TEXT NOT NULL CHECK (user_type IN ('club', 'league', 'fan', 'guest')),
  created_at TIMESTAMPTZ DEFAULT timezone('utc'::text, now()) NOT NULL,
  -- One row per email per interest type; re-submitting is a friendly no-op
  UNIQUE (email, user_type)
);

ALTER TABLE waitlist ENABLE ROW LEVEL SECURITY;
-- No policies on purpose: service-role access only.

CREATE INDEX IF NOT EXISTS idx_waitlist_created_at ON waitlist (created_at DESC);

-- ── Verification (run after) ────────────────────────────────────────────────
-- SELECT count(*) FROM waitlist;  → expect 0 (and no error)
