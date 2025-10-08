import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // Missing required Supabase environment variables
}

// Supabase configuration loaded

// Client-side Supabase client (for browser use) with SSR-compatible cookie storage
// This will automatically use cookies instead of localStorage for better SSR compatibility
let supabaseInstance: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (supabaseInstance) return supabaseInstance;

  supabaseInstance = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return supabaseInstance;
}

// For backward compatibility, export as supabase
export const supabase = typeof window !== 'undefined'
  ? getSupabaseBrowserClient()
  : createClient(supabaseUrl, supabaseAnonKey); // Fallback for SSR contexts

// Server-side Supabase client with service role key (bypasses RLS)
export const supabaseAdmin = supabaseServiceRoleKey 
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    })
  : null;

// Browser client for client-side operations
export function createSupabaseBrowserClient() {
  return createBrowserClient(supabaseUrl, supabaseAnonKey);
}

// Types for our database
export interface Profile {
  id: string;
  email: string;
  first_name?: string;
  last_name?: string;
  nickname?: string;
  phone?: string;
  birthday?: string;
  birthdate?: string;
  gender?: 'male' | 'female' | 'custom';
  location?: string;
  postal_code?: string;
  user_type: 'athlete' | 'club' | 'league' | 'fan';
  created_at: string;
  updated_at: string;
  // Extended athlete profile fields
  middle_name?: string;
  username?: string;
  full_name?: string; // This is now the username/handle
  handle?: string; // Unique @handle identifier
  bio?: string;
  sport?: string;
  position?: string;
  school?: string;
  team?: string;
  height?: number;
  height_cm?: number;
  weight_kg?: number;
  weight_display?: number;
  weight_unit?: 'lbs' | 'kg' | 'stone';
  dob?: string;
  class_year?: number;
  social_twitter?: string;
  social_instagram?: string;
  social_facebook?: string;
  twitter_handle?: string;
  instagram_handle?: string;
  avatar_url?: string;
  // Privacy settings
  visibility?: 'public' | 'private';
  // Golf-specific fields
  golf_handicap?: number;
  golf_home_course?: string;
  golf_tee_preference?: string;
  golf_dominant_hand?: string;
  golf_driver_brand?: string;
  golf_driver_loft?: number;
  golf_irons_brand?: string;
  golf_putter_brand?: string;
  golf_ball_brand?: string;
}

export interface AthleteBadge {
  id: string;
  profile_id: string;
  label: string;
  icon_url?: string;
  color_token: string;
  position: number;
  created_at: string;
  updated_at: string;
}

export interface Sport {
  id: string;
  profile_id: string;
  sport_key: string;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SeasonHighlight {
  id: string;
  profile_id: string;
  sport_key: string;
  season: string;
  metric_a?: string;  // TEXT in database for flexibility (e.g., "Goals: 15", "Time: 2:30")
  metric_b?: string;  // TEXT in database for flexibility
  metric_c?: string;  // TEXT in database for flexibility
  rating?: number;    // NUMERIC in database (0-100)
  league_tags?: string[];  // Array of league affiliations (e.g., ["NCAA D1", "Big Ten"])
  created_at: string;
  updated_at: string;
}

export interface Performance {
  id: string;
  profile_id: string;
  date: string;
  event: string;
  result_place?: string;
  stat_primary?: string;
  organization?: string;
  athletic_score?: number;
  created_at: string;
  updated_at: string;
}

export interface Club {
  id: string;
  name: string;
  description?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}

export interface Comment {
  id: string;
  post_id: string;
  profile_id: string;
  parent_comment_id?: string;
  content: string;
  created_at: string;
  updated_at: string;
  likes_count?: number;
  profile?: Profile;
  comment_likes?: { profile_id: string }[];
}