-- ============================================================================
-- 166: Reserved root slugs — the vanity-path namespace guard (phase 6 R1)
-- ============================================================================
-- Phase 6 puts org sites at edgeathlete.<tld>/{slug} (the "NHL.com/team"
-- model, hosted inside Edge Athlete). From this migration on, an org-site
-- slug IS a root URL path segment, so every routable root segment must be
-- unmintable as a slug. The app enforces the same list code-side
-- (src/lib/org-sites/reserved.ts, whose test pins it to the live route
-- tree) — this seed is defense-in-depth and covers any future write path.
--
-- Idempotent: ON CONFLICT DO NOTHING against the 006 table.
-- ============================================================================

INSERT INTO reserved_handles (handle, reason) VALUES
  -- (app) root segments not already seeded by 006
  ('activate',        'Root path (vanity namespace, 166)'),
  ('athlete-claim',   'Root path (vanity namespace, 166)'),
  ('auth',            'Root path (vanity namespace, 166)'),
  ('calendar',        'Root path (vanity namespace, 166)'),
  ('contact',         'Root path (vanity namespace, 166)'),
  ('explore',         'Root path (vanity namespace, 166)'),
  ('feed',            'Root path (vanity namespace, 166)'),
  ('forgot-password', 'Root path (vanity namespace, 166)'),
  ('goodbye',         'Root path (vanity namespace, 166)'),
  ('invite',          'Root path (vanity namespace, 166)'),
  ('live',            'Root path (vanity namespace, 166)'),
  ('login',           'Root path (vanity namespace, 166)'),
  ('messages',        'Root path (vanity namespace, 166)'),
  ('notifications',   'Root path (vanity namespace, 166)'),
  ('onboarding',      'Root path (vanity namespace, 166)'),
  ('org-claim',       'Root path (vanity namespace, 166)'),
  ('privacy',         'Root path (vanity namespace, 166)'),
  ('register',        'Root path (vanity namespace, 166)'),
  ('reset-password',  'Root path (vanity namespace, 166)'),
  ('terms',           'Root path (vanity namespace, 166)'),
  -- Root-level entries outside the (app) group
  ('org',                  'Root path (vanity namespace, 166)'),
  ('robots.txt',           'Root file (vanity namespace, 166)'),
  ('sitemap.xml',          'Root file (vanity namespace, 166)'),
  ('favicon.ico',          'Root file (vanity namespace, 166)'),
  ('manifest.webmanifest', 'Root file (vanity namespace, 166)'),
  -- Next metadata conventions
  ('opengraph-image', 'Next metadata route (166)'),
  ('twitter-image',   'Next metadata route (166)'),
  ('icon',            'Next metadata route (166)'),
  ('apple-icon',      'Next metadata route (166)'),
  -- Future-proofing / squat-shaped words
  ('about',    'Reserved word (166)'),
  ('signup',   'Reserved word (166)'),
  ('signin',   'Reserved word (166)'),
  ('sign-in',  'Reserved word (166)'),
  ('sign-up',  'Reserved word (166)'),
  ('home',     'Reserved word (166)'),
  ('index',    'Reserved word (166)'),
  ('search',   'Reserved word (166)'),
  ('blog',     'Reserved word (166)'),
  ('docs',     'Reserved word (166)'),
  ('pricing',  'Reserved word (166)'),
  ('assets',   'Reserved word (166)'),
  ('static',   'Reserved word (166)'),
  ('media',    'Reserved word (166)'),
  ('www',      'Reserved word (166)'),
  ('preview',  'Reserved word (166)'),
  ('teams',    'Reserved word (166)'),
  ('events',   'Reserved word (166)'),
  ('news',     'Reserved word (166)'),
  ('store',    'Reserved word (166)'),
  ('shop',     'Reserved word (166)')
ON CONFLICT (handle) DO NOTHING;

-- ============================================================================
-- CHECK GRID — run after the insert; paste the grid back.
-- ============================================================================
-- 1) Coverage booleans (expect both true):
SELECT
  EXISTS (SELECT 1 FROM reserved_handles WHERE handle = 'feed')       AS feed_reserved,
  EXISTS (SELECT 1 FROM reserved_handles WHERE handle = 'robots.txt') AS robots_reserved,
  (SELECT count(*) FROM reserved_handles)                             AS total_reserved;

-- 2) THE RETRO CHECK — existing org-site slugs colliding with the root
--    namespace. EXPECT ZERO ROWS; any row here must be renamed before the
--    vanity routes deploy (report it back and we decide the rename).
SELECT subdomain FROM org_sites WHERE subdomain IN (
  'activate','app','athlete','athlete-claim','auth','calendar','club',
  'contact','dashboard','explore','feed','forgot-password','goodbye',
  'invite','league','live','login','messages','notifications','onboarding',
  'org-claim','privacy','register','reset-password','settings','terms','u',
  'api','org','robots.txt','sitemap.xml','favicon.ico','manifest.webmanifest',
  'opengraph-image','twitter-image','icon','apple-icon',
  'about','help','support','legal','signup','signin','sign-in','sign-up',
  'home','index','search','blog','docs','pricing','assets','static','media',
  'www','preview','admin','account','profile','user','users','athletes',
  'clubs','leagues','teams','events','news','store','shop'
);
