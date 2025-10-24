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
  penalty?: number;  // Penalty strokes
  sand?: boolean;  // Hit sand bunker
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

// Course hole template (from golf-courses-db.ts)
export interface CourseHole {
  number: number;
  par: number;
  yardage: {
    black?: number;
    blue?: number;
    white?: number;
    gold?: number;
    red?: number;
  };
  handicap: number;
}

// Golf course definition
export interface GolfCourse {
  id: string;
  name: string;
  city?: string;
  state?: string;
  country?: string;
  holes: CourseHole[];
  totalPar: number;
  courseRating: Record<string, number>;
  slopeRating: Record<string, number>;
  description?: string;
}
