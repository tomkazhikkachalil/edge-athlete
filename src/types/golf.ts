/**
 * Golf Type Definitions
 * Shared types for golf rounds, holes, and scorecards
 */

// Hole data for scorecard entry forms
export interface HoleData {
  hole?: number;
  hole_number?: number; // Used in database records
  par: number;
  yardage?: number;
  handicap?: number;
  score?: number;
  strokes?: number | null; // Used in database records
  putts?: number | null;
  fairway?: 'left' | 'right' | 'hit' | 'na';  // na for par 3s
  fairway_hit?: boolean | null; // Used in database records
  gir?: boolean;  // Green in Regulation
  green_in_regulation?: boolean | null; // Used in database records
  /** One element per occurrence — vocabulary in src/lib/golf/penalties.ts (migration 078). */
  penalties?: string[] | null;
  notes?: string;
}

// Individual hole score (for individual rounds)
export interface GolfHole {
  hole_number: number;
  par: number;
  distance_yards?: number;
  strokes?: number; // Optional - may not be entered yet
  putts?: number;
  fairway_hit?: boolean;
  green_in_regulation?: boolean;
}

// Golf round data (for individual rounds)
export interface GolfRound {
  id?: string;
  course?: string;
  course_name?: string;
  date?: string;
  tee?: string;
  holes?: number;
  gross_score?: number;
  total_putts?: number;
  fir_percentage?: number | null;
  gir_percentage?: number | null;
  round_type?: 'indoor' | 'outdoor';
  weather?: string;
  temperature?: number;
  wind?: string;
  course_rating?: number;
  slope_rating?: number;
  golf_holes?: GolfHole[];
}

// Course hole template (golf_courses.hole_data rows — the catalog).
// Yardage is keyed by tee NAME, not a fixed color set: external providers
// use free-text tee names ("Championship", "Tips"), so the old
// black/blue/white/gold/red keying is only one possible vocabulary.
export interface CourseHole {
  number: number;
  par: number;
  yardage: Record<string, number>;
  handicap: number;
}

// Golf course definition
export interface GolfCourse {
  id: string;
  name: string;
  /** Catalog provenance ('seed' | 'opengolfapi' | 'golfcourseapi' | 'osm');
   *  absent for history/custom courses. 'osm' rows are identity-only and
   *  never gain tees/holes — the picker says so instead of promising them. */
  source?: string;
  city?: string;
  state?: string;
  country?: string;
  holes: CourseHole[];
  totalPar: number;
  /** Course length from the catalog (9 or 18) — sizes the composer grid. */
  holesCount?: number;
  courseRating: Record<string, number>;
  slopeRating: Record<string, number>;
  // Catalog details (migration 101) — optional; absent for history/custom.
  lat?: number;
  lng?: number;
  description?: string;
  /** CC BY-SA attribution — MUST render wherever description does. */
  descriptionAttribution?: string;
  architect?: string;
  yearBuilt?: number;
  courseType?: string;
  website?: string;
}
