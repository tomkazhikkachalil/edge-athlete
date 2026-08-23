-- ============================================================================
-- 100: golf_courses — the global course catalog
-- ============================================================================
-- Course data goes global: a DB-backed catalog replaces the 7-course static
-- TS file (src/lib/golf-courses-db.ts, deleted in the same PR). Rows come
-- from three sources, tracked in external_source:
--   'seed'          — the 7 static courses, carried over verbatim below
--   'opengolfapi'   — OpenGolfAPI (keyless, US-complete; ODbL attribution)
--   'golfcourseapi' — GolfCourseAPI (global; key + 50-req/day budget guard)
-- Providers are called only on explicit "search worldwide" and on selection
-- of a thin row (hydration) — never per keystroke. See
-- src/lib/golf/course-catalog.ts for the whole provider surface.
--
-- Ratings/slope are jsonb keyed by tee name — provider tee names are free
-- text ("Championship", "Tips"), so per-color columns would re-encode the
-- fixed-5-color assumption the providers break. hole_data follows the
-- golf_scorecard_data.hole_data precedent.
--
-- Also links rounds to the catalog: golf_scorecard_data.course_id has been
-- an orphan UUID since 004 (no FK, never written) — it gains its FK here;
-- golf_rounds gains a matching nullable course_id. Both keep their
-- denormalized course-name text: rounds at off-catalog courses stay legal.
-- ============================================================================

-- ── Table ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS golf_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  external_source text NOT NULL,
  external_id text NOT NULL,
  name text NOT NULL,
  club_name text,
  city text,
  region text,
  country text,
  total_par integer,
  holes_count integer,
  -- [{number, par, yardage: {<tee>: yards}, handicap}] — empty/null = holes
  -- unknown (the composer's standard-par fallback covers it; we never
  -- fabricate hole data).
  hole_data jsonb,
  course_rating jsonb NOT NULL DEFAULT '{}'::jsonb,
  slope_rating jsonb NOT NULL DEFAULT '{}'::jsonb,
  lat double precision,
  lng double precision,
  created_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamptz NOT NULL DEFAULT timezone('utc'::text, now()),
  UNIQUE (external_source, external_id)
);

DROP TRIGGER IF EXISTS handle_updated_at_golf_courses ON golf_courses;
CREATE TRIGGER handle_updated_at_golf_courses
  BEFORE UPDATE ON golf_courses
  FOR EACH ROW EXECUTE PROCEDURE public.handle_updated_at();

-- ── Search indexes (the 087 pair: NO full-text search — course names hit
--    the same stop-word/whole-word failures 087 documents) ───────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_golf_courses_name_trgm
  ON golf_courses USING GIN (lower(name) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_golf_courses_name_prefix
  ON golf_courses ((lower(name) COLLATE "C"));

-- ── RLS: public reference data (reserved_handles pattern) ────────────────────
ALTER TABLE golf_courses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Golf courses are viewable by everyone" ON golf_courses;
CREATE POLICY "Golf courses are viewable by everyone"
  ON golf_courses FOR SELECT
  USING (true);
-- No write policies: inserts/updates go through the service role only.

-- ── Round → catalog links ────────────────────────────────────────────────────
ALTER TABLE golf_rounds
  ADD COLUMN IF NOT EXISTS course_id uuid REFERENCES golf_courses(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_golf_rounds_course_id ON golf_rounds (course_id);

-- golf_scorecard_data.course_id exists since 004, all-NULL — the FK is free.
-- (DO block: ADD CONSTRAINT has no IF NOT EXISTS; migration must be re-runnable.)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_course_id_fkey') THEN
    ALTER TABLE golf_scorecard_data
      ADD CONSTRAINT golf_scorecard_data_course_id_fkey
      FOREIGN KEY (course_id) REFERENCES golf_courses(id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_golf_scorecard_data_course_id ON golf_scorecard_data (course_id);

-- ── Seed: the 7 static courses, verbatim, with FIXED ids (stable across
--    environments; re-runnable via ON CONFLICT DO NOTHING) ────────────────────
INSERT INTO golf_courses
  (id, external_source, external_id, name, club_name, city, region, country, total_par, holes_count, hole_data, course_rating, slope_rating, lat, lng)
VALUES
  ('9c504cde-d0c1-5c17-a568-063446830d98', 'seed', 'pebble-beach', 'Pebble Beach Golf Links', NULL, 'Pebble Beach', 'California', 'USA', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 377, "blue": 377, "white": 350, "gold": 335, "red": 308}, "handicap": 11}, {"number": 2, "par": 5, "yardage": {"black": 502, "blue": 502, "white": 480, "gold": 450, "red": 417}, "handicap": 15}, {"number": 3, "par": 4, "yardage": {"black": 390, "blue": 390, "white": 370, "gold": 340, "red": 310}, "handicap": 5}, {"number": 4, "par": 4, "yardage": {"black": 327, "blue": 327, "white": 310, "gold": 288, "red": 268}, "handicap": 17}, {"number": 5, "par": 3, "yardage": {"black": 188, "blue": 188, "white": 166, "gold": 148, "red": 130}, "handicap": 7}, {"number": 6, "par": 5, "yardage": {"black": 523, "blue": 523, "white": 495, "gold": 465, "red": 430}, "handicap": 1}, {"number": 7, "par": 3, "yardage": {"black": 106, "blue": 106, "white": 100, "gold": 95, "red": 85}, "handicap": 13}, {"number": 8, "par": 4, "yardage": {"black": 418, "blue": 418, "white": 395, "gold": 365, "red": 335}, "handicap": 3}, {"number": 9, "par": 4, "yardage": {"black": 464, "blue": 464, "white": 440, "gold": 410, "red": 380}, "handicap": 9}, {"number": 10, "par": 4, "yardage": {"black": 446, "blue": 446, "white": 424, "gold": 390, "red": 360}, "handicap": 2}, {"number": 11, "par": 4, "yardage": {"black": 384, "blue": 384, "white": 365, "gold": 335, "red": 305}, "handicap": 12}, {"number": 12, "par": 3, "yardage": {"black": 202, "blue": 202, "white": 180, "gold": 158, "red": 135}, "handicap": 16}, {"number": 13, "par": 4, "yardage": {"black": 392, "blue": 392, "white": 370, "gold": 340, "red": 310}, "handicap": 8}, {"number": 14, "par": 5, "yardage": {"black": 580, "blue": 580, "white": 555, "gold": 520, "red": 485}, "handicap": 6}, {"number": 15, "par": 4, "yardage": {"black": 397, "blue": 397, "white": 375, "gold": 345, "red": 315}, "handicap": 10}, {"number": 16, "par": 4, "yardage": {"black": 402, "blue": 402, "white": 380, "gold": 350, "red": 320}, "handicap": 14}, {"number": 17, "par": 3, "yardage": {"black": 209, "blue": 209, "white": 180, "gold": 158, "red": 135}, "handicap": 18}, {"number": 18, "par": 5, "yardage": {"black": 543, "blue": 543, "white": 520, "gold": 485, "red": 450}, "handicap": 4}]'::jsonb, '{"black": 75.5, "blue": 74, "white": 71.4, "gold": 68.8, "red": 71}'::jsonb, '{"black": 145, "blue": 142, "white": 133, "gold": 124, "red": 129}'::jsonb, 36.5675, -121.9481),
  ('a4433878-ed89-5cdb-aab5-d29ee34bc92f', 'seed', 'augusta-national', 'Augusta National Golf Club', NULL, 'Augusta', 'Georgia', 'USA', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 445, "blue": 435, "white": 400}, "handicap": 9}, {"number": 2, "par": 5, "yardage": {"black": 575, "blue": 565, "white": 525}, "handicap": 11}, {"number": 3, "par": 4, "yardage": {"black": 350, "blue": 340, "white": 320}, "handicap": 15}, {"number": 4, "par": 3, "yardage": {"black": 240, "blue": 230, "white": 205}, "handicap": 17}, {"number": 5, "par": 4, "yardage": {"black": 495, "blue": 485, "white": 455}, "handicap": 1}, {"number": 6, "par": 3, "yardage": {"black": 180, "blue": 175, "white": 165}, "handicap": 13}, {"number": 7, "par": 4, "yardage": {"black": 450, "blue": 440, "white": 410}, "handicap": 3}, {"number": 8, "par": 5, "yardage": {"black": 570, "blue": 560, "white": 520}, "handicap": 7}, {"number": 9, "par": 4, "yardage": {"black": 460, "blue": 450, "white": 420}, "handicap": 5}, {"number": 10, "par": 4, "yardage": {"black": 495, "blue": 485, "white": 455}, "handicap": 2}, {"number": 11, "par": 4, "yardage": {"black": 520, "blue": 510, "white": 480}, "handicap": 4}, {"number": 12, "par": 3, "yardage": {"black": 155, "blue": 150, "white": 140}, "handicap": 16}, {"number": 13, "par": 5, "yardage": {"black": 510, "blue": 500, "white": 470}, "handicap": 8}, {"number": 14, "par": 4, "yardage": {"black": 440, "blue": 430, "white": 400}, "handicap": 12}, {"number": 15, "par": 5, "yardage": {"black": 530, "blue": 520, "white": 490}, "handicap": 6}, {"number": 16, "par": 3, "yardage": {"black": 170, "blue": 165, "white": 155}, "handicap": 18}, {"number": 17, "par": 4, "yardage": {"black": 440, "blue": 430, "white": 400}, "handicap": 10}, {"number": 18, "par": 4, "yardage": {"black": 465, "blue": 455, "white": 425}, "handicap": 14}]'::jsonb, '{"black": 78.1, "blue": 76.2, "white": 73.9}'::jsonb, '{"black": 155, "blue": 148, "white": 137}'::jsonb, 33.503, -82.0199),
  ('e08fd957-c736-5c6a-80fa-c7f072828ceb', 'seed', 'st-andrews-old', 'St. Andrews Old Course', NULL, 'St. Andrews', 'Scotland', 'UK', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 376, "blue": 376, "white": 364}, "handicap": 13}, {"number": 2, "par": 4, "yardage": {"black": 453, "blue": 411, "white": 367}, "handicap": 7}, {"number": 3, "par": 4, "yardage": {"black": 397, "blue": 371, "white": 340}, "handicap": 11}, {"number": 4, "par": 4, "yardage": {"black": 480, "blue": 463, "white": 419}, "handicap": 1}, {"number": 5, "par": 5, "yardage": {"black": 570, "blue": 568, "white": 514}, "handicap": 5}, {"number": 6, "par": 4, "yardage": {"black": 414, "blue": 374, "white": 348}, "handicap": 15}, {"number": 7, "par": 4, "yardage": {"black": 372, "blue": 359, "white": 334}, "handicap": 9}, {"number": 8, "par": 3, "yardage": {"black": 178, "blue": 166, "white": 148}, "handicap": 17}, {"number": 9, "par": 4, "yardage": {"black": 352, "blue": 307, "white": 268}, "handicap": 3}, {"number": 10, "par": 4, "yardage": {"black": 386, "blue": 342, "white": 318}, "handicap": 14}, {"number": 11, "par": 3, "yardage": {"black": 174, "blue": 172, "white": 164}, "handicap": 18}, {"number": 12, "par": 4, "yardage": {"black": 348, "blue": 316, "white": 292}, "handicap": 10}, {"number": 13, "par": 4, "yardage": {"black": 465, "blue": 425, "white": 398}, "handicap": 6}, {"number": 14, "par": 5, "yardage": {"black": 614, "blue": 567, "white": 530}, "handicap": 4}, {"number": 15, "par": 4, "yardage": {"black": 456, "blue": 413, "white": 383}, "handicap": 8}, {"number": 16, "par": 4, "yardage": {"black": 423, "blue": 382, "white": 351}, "handicap": 12}, {"number": 17, "par": 4, "yardage": {"black": 495, "blue": 461, "white": 424}, "handicap": 2}, {"number": 18, "par": 4, "yardage": {"black": 357, "blue": 354, "white": 354}, "handicap": 16}]'::jsonb, '{"black": 74.4, "blue": 72.8, "white": 70.2}'::jsonb, '{"black": 140, "blue": 135, "white": 125}'::jsonb, 56.3426, -2.8159),
  ('d7e46200-384b-5595-8c67-20bfdc34baa5', 'seed', 'pinehurst-no2', 'Pinehurst No. 2', NULL, 'Pinehurst', 'North Carolina', 'USA', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 401, "blue": 390, "white": 375}, "handicap": 11}, {"number": 2, "par": 4, "yardage": {"black": 502, "blue": 485, "white": 450}, "handicap": 5}, {"number": 3, "par": 4, "yardage": {"black": 390, "blue": 375, "white": 350}, "handicap": 13}, {"number": 4, "par": 4, "yardage": {"black": 554, "blue": 540, "white": 510}, "handicap": 1}, {"number": 5, "par": 4, "yardage": {"black": 482, "blue": 465, "white": 430}, "handicap": 3}, {"number": 6, "par": 3, "yardage": {"black": 212, "blue": 195, "white": 175}, "handicap": 15}, {"number": 7, "par": 4, "yardage": {"black": 407, "blue": 390, "white": 365}, "handicap": 9}, {"number": 8, "par": 4, "yardage": {"black": 485, "blue": 470, "white": 445}, "handicap": 7}, {"number": 9, "par": 4, "yardage": {"black": 460, "blue": 445, "white": 420}, "handicap": 17}, {"number": 10, "par": 4, "yardage": {"black": 611, "blue": 595, "white": 570}, "handicap": 2}, {"number": 11, "par": 4, "yardage": {"black": 434, "blue": 420, "white": 395}, "handicap": 6}, {"number": 12, "par": 4, "yardage": {"black": 469, "blue": 455, "white": 430}, "handicap": 10}, {"number": 13, "par": 4, "yardage": {"black": 377, "blue": 365, "white": 340}, "handicap": 16}, {"number": 14, "par": 4, "yardage": {"black": 477, "blue": 460, "white": 435}, "handicap": 8}, {"number": 15, "par": 3, "yardage": {"black": 204, "blue": 190, "white": 175}, "handicap": 18}, {"number": 16, "par": 4, "yardage": {"black": 509, "blue": 495, "white": 470}, "handicap": 4}, {"number": 17, "par": 3, "yardage": {"black": 195, "blue": 185, "white": 170}, "handicap": 14}, {"number": 18, "par": 4, "yardage": {"black": 440, "blue": 425, "white": 400}, "handicap": 12}]'::jsonb, '{"black": 75.3, "blue": 73.6, "white": 71}'::jsonb, '{"black": 147, "blue": 140, "white": 129}'::jsonb, 35.1954, -79.4683),
  ('05c9ad61-9800-58bd-b940-5475d037ab82', 'seed', 'rideau-view', 'Rideau View Golf Club', NULL, 'Ottawa', 'Ontario', 'Canada', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 410, "blue": 385, "white": 360, "gold": 335, "red": 310}, "handicap": 7}, {"number": 2, "par": 4, "yardage": {"black": 390, "blue": 365, "white": 340, "gold": 315, "red": 290}, "handicap": 13}, {"number": 3, "par": 3, "yardage": {"black": 180, "blue": 165, "white": 150, "gold": 135, "red": 120}, "handicap": 17}, {"number": 4, "par": 5, "yardage": {"black": 520, "blue": 495, "white": 470, "gold": 445, "red": 420}, "handicap": 3}, {"number": 5, "par": 4, "yardage": {"black": 415, "blue": 390, "white": 365, "gold": 340, "red": 315}, "handicap": 9}, {"number": 6, "par": 4, "yardage": {"black": 380, "blue": 355, "white": 330, "gold": 305, "red": 280}, "handicap": 15}, {"number": 7, "par": 3, "yardage": {"black": 175, "blue": 160, "white": 145, "gold": 130, "red": 115}, "handicap": 11}, {"number": 8, "par": 5, "yardage": {"black": 535, "blue": 510, "white": 485, "gold": 460, "red": 435}, "handicap": 1}, {"number": 9, "par": 4, "yardage": {"black": 425, "blue": 400, "white": 375, "gold": 350, "red": 325}, "handicap": 5}, {"number": 10, "par": 4, "yardage": {"black": 395, "blue": 370, "white": 345, "gold": 320, "red": 295}, "handicap": 8}, {"number": 11, "par": 3, "yardage": {"black": 165, "blue": 150, "white": 135, "gold": 120, "red": 105}, "handicap": 16}, {"number": 12, "par": 4, "yardage": {"black": 420, "blue": 395, "white": 370, "gold": 345, "red": 320}, "handicap": 4}, {"number": 13, "par": 4, "yardage": {"black": 405, "blue": 380, "white": 355, "gold": 330, "red": 305}, "handicap": 12}, {"number": 14, "par": 5, "yardage": {"black": 545, "blue": 520, "white": 495, "gold": 470, "red": 445}, "handicap": 2}, {"number": 15, "par": 3, "yardage": {"black": 190, "blue": 175, "white": 160, "gold": 145, "red": 130}, "handicap": 18}, {"number": 16, "par": 4, "yardage": {"black": 385, "blue": 360, "white": 335, "gold": 310, "red": 285}, "handicap": 14}, {"number": 17, "par": 4, "yardage": {"black": 430, "blue": 405, "white": 380, "gold": 355, "red": 330}, "handicap": 6}, {"number": 18, "par": 4, "yardage": {"black": 440, "blue": 415, "white": 390, "gold": 365, "red": 340}, "handicap": 10}]'::jsonb, '{"black": 73.2, "blue": 71.8, "white": 69.5, "gold": 67.2, "red": 69.8}'::jsonb, '{"black": 135, "blue": 130, "white": 125, "gold": 118, "red": 125}'::jsonb, 45.3311, -75.7581),
  ('9206468b-36e2-5c54-b8c3-e8a2d60b4f9f', 'seed', 'ottawa-hunt', 'Ottawa Hunt and Golf Club', NULL, 'Ottawa', 'Ontario', 'Canada', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 425, "blue": 400, "white": 375, "gold": 350, "red": 325}, "handicap": 5}, {"number": 2, "par": 4, "yardage": {"black": 405, "blue": 380, "white": 355, "gold": 330, "red": 305}, "handicap": 11}, {"number": 3, "par": 3, "yardage": {"black": 195, "blue": 180, "white": 165, "gold": 150, "red": 135}, "handicap": 15}, {"number": 4, "par": 5, "yardage": {"black": 550, "blue": 525, "white": 500, "gold": 475, "red": 450}, "handicap": 1}, {"number": 5, "par": 4, "yardage": {"black": 440, "blue": 415, "white": 390, "gold": 365, "red": 340}, "handicap": 7}, {"number": 6, "par": 4, "yardage": {"black": 395, "blue": 370, "white": 345, "gold": 320, "red": 295}, "handicap": 13}, {"number": 7, "par": 3, "yardage": {"black": 170, "blue": 155, "white": 140, "gold": 125, "red": 110}, "handicap": 17}, {"number": 8, "par": 5, "yardage": {"black": 520, "blue": 495, "white": 470, "gold": 445, "red": 420}, "handicap": 3}, {"number": 9, "par": 4, "yardage": {"black": 415, "blue": 390, "white": 365, "gold": 340, "red": 315}, "handicap": 9}, {"number": 10, "par": 4, "yardage": {"black": 430, "blue": 405, "white": 380, "gold": 355, "red": 330}, "handicap": 6}, {"number": 11, "par": 3, "yardage": {"black": 185, "blue": 170, "white": 155, "gold": 140, "red": 125}, "handicap": 16}, {"number": 12, "par": 4, "yardage": {"black": 410, "blue": 385, "white": 360, "gold": 335, "red": 310}, "handicap": 8}, {"number": 13, "par": 4, "yardage": {"black": 390, "blue": 365, "white": 340, "gold": 315, "red": 290}, "handicap": 14}, {"number": 14, "par": 5, "yardage": {"black": 535, "blue": 510, "white": 485, "gold": 460, "red": 435}, "handicap": 2}, {"number": 15, "par": 3, "yardage": {"black": 160, "blue": 145, "white": 130, "gold": 115, "red": 100}, "handicap": 18}, {"number": 16, "par": 4, "yardage": {"black": 420, "blue": 395, "white": 370, "gold": 345, "red": 320}, "handicap": 10}, {"number": 17, "par": 4, "yardage": {"black": 450, "blue": 425, "white": 400, "gold": 375, "red": 350}, "handicap": 4}, {"number": 18, "par": 4, "yardage": {"black": 445, "blue": 420, "white": 395, "gold": 370, "red": 345}, "handicap": 12}]'::jsonb, '{"black": 74.8, "blue": 73.2, "white": 71.6, "gold": 69.4, "red": 72.1}'::jsonb, '{"black": 140, "blue": 135, "white": 130, "gold": 122, "red": 128}'::jsonb, 45.3847, -75.7294),
  ('aa2713e6-0b4f-5220-948c-3ec768208be5', 'seed', 'eagle-creek-kanata', 'Eagle Creek Golf Club', NULL, 'Ottawa', 'Ontario', 'Canada', 72, 18, '[{"number": 1, "par": 4, "yardage": {"black": 420, "blue": 395, "white": 370, "gold": 345, "red": 320}, "handicap": 9}, {"number": 2, "par": 5, "yardage": {"black": 540, "blue": 515, "white": 490, "gold": 465, "red": 440}, "handicap": 3}, {"number": 3, "par": 3, "yardage": {"black": 175, "blue": 160, "white": 145, "gold": 130, "red": 115}, "handicap": 15}, {"number": 4, "par": 4, "yardage": {"black": 405, "blue": 380, "white": 355, "gold": 330, "red": 305}, "handicap": 7}, {"number": 5, "par": 4, "yardage": {"black": 385, "blue": 360, "white": 335, "gold": 310, "red": 285}, "handicap": 13}, {"number": 6, "par": 3, "yardage": {"black": 190, "blue": 175, "white": 160, "gold": 145, "red": 130}, "handicap": 17}, {"number": 7, "par": 5, "yardage": {"black": 525, "blue": 500, "white": 475, "gold": 450, "red": 425}, "handicap": 1}, {"number": 8, "par": 4, "yardage": {"black": 410, "blue": 385, "white": 360, "gold": 335, "red": 310}, "handicap": 5}, {"number": 9, "par": 4, "yardage": {"black": 435, "blue": 410, "white": 385, "gold": 360, "red": 335}, "handicap": 11}, {"number": 10, "par": 4, "yardage": {"black": 395, "blue": 370, "white": 345, "gold": 320, "red": 295}, "handicap": 10}, {"number": 11, "par": 4, "yardage": {"black": 425, "blue": 400, "white": 375, "gold": 350, "red": 325}, "handicap": 6}, {"number": 12, "par": 3, "yardage": {"black": 165, "blue": 150, "white": 135, "gold": 120, "red": 105}, "handicap": 16}, {"number": 13, "par": 5, "yardage": {"black": 515, "blue": 490, "white": 465, "gold": 440, "red": 415}, "handicap": 2}, {"number": 14, "par": 4, "yardage": {"black": 400, "blue": 375, "white": 350, "gold": 325, "red": 300}, "handicap": 12}, {"number": 15, "par": 3, "yardage": {"black": 180, "blue": 165, "white": 150, "gold": 135, "red": 120}, "handicap": 18}, {"number": 16, "par": 4, "yardage": {"black": 415, "blue": 390, "white": 365, "gold": 340, "red": 315}, "handicap": 8}, {"number": 17, "par": 4, "yardage": {"black": 440, "blue": 415, "white": 390, "gold": 365, "red": 340}, "handicap": 4}, {"number": 18, "par": 4, "yardage": {"black": 460, "blue": 435, "white": 410, "gold": 385, "red": 360}, "handicap": 14}]'::jsonb, '{"black": 73.8, "blue": 72.1, "white": 70.3, "gold": 68.1, "red": 70.9}'::jsonb, '{"black": 138, "blue": 133, "white": 128, "gold": 120, "red": 126}'::jsonb, 45.2669, -76.0697)
ON CONFLICT (external_source, external_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- ── Re-runnable check grid (run separately if pasting mangles quotes) ────────
-- Expect: seed_rows 7, table_rls true, fk_scorecard true, fk_rounds true,
--         idx_trgm true, idx_prefix true.
SELECT
  (SELECT count(*) FROM golf_courses WHERE external_source = 'seed') AS seed_rows,
  (SELECT relrowsecurity FROM pg_class WHERE relname = 'golf_courses') AS table_rls,
  EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'golf_scorecard_data_course_id_fkey') AS fk_scorecard,
  EXISTS (SELECT 1 FROM pg_constraint
          WHERE conrelid = 'golf_rounds'::regclass AND confrelid = 'golf_courses'::regclass) AS fk_rounds,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_name_trgm') AS idx_trgm,
  EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_golf_courses_name_prefix') AS idx_prefix;
