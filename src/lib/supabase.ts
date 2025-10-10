import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required Supabase environment variables. Please set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY');
  // Provide helpful error message in development
  if (process.env.NODE_ENV === 'development') {
    throw new Error('Missing Supabase environment variables. Check your .env.local file.');
  }
}

// Supabase configuration loaded

// Client-side Supabase client (for browser use) with SSR-compatible cookie storage
// This will automatically use cookies instead of localStorage for better SSR compatibility
let supabaseInstance: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowserClient() {
  if (supabaseInstance) return supabaseInstance;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('Cannot initialize Supabase client: missing environment variables');
  }

  supabaseInstance = createBrowserClient(supabaseUrl, supabaseAnonKey);
  return supabaseInstance;
}

// For backward compatibility, export as supabase
// Create a safe default that will work in SSR but throw helpful errors if env vars are missing
export const supabase = (() => {
  try {
    if (typeof window !== 'undefined') {
      return getSupabaseBrowserClient();
    } else {
      // SSR context
      if (supabaseUrl && supabaseAnonKey) {
        return createClient(supabaseUrl, supabaseAnonKey);
      }
      // Return a dummy client for SSR - will fail gracefully if actually used
      return createClient('https://placeholder.supabase.co', 'placeholder-key');
    }
  } catch (error) {
    console.error('Failed to initialize Supabase client:', error);
    // Return a dummy client that will fail gracefully
    return createClient('https://placeholder.supabase.co', 'placeholder-key');
  }
})();

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
  // Note: Sport-specific settings (golf, hockey, etc.) are now stored in the sport_settings table
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

// Sport-specific settings interfaces
export interface GolfSettings {
  handicap?: number;
  home_course?: string;
  tee_preference?: string;
  dominant_hand?: string;
  driver_brand?: string;
  driver_loft?: number;
  irons_brand?: string;
  putter_brand?: string;
  ball_brand?: string;
}

export interface HockeySettings {
  position?: string;
  stick_flex?: number;
  shot_preference?: 'left' | 'right';
  blade_curve?: string;
  // Add more hockey-specific settings as needed
}

export interface BasketballSettings {
  position?: string;
  shoe_size?: number;
  jersey_number?: number;
  // Add more basketball-specific settings as needed
}

// Generic sport settings (stored in database)
export interface SportSettings {
  id: string;
  profile_id: string;
  sport_key: string;
  settings: GolfSettings | HockeySettings | BasketballSettings | Record<string, unknown>;
  created_at: string;
  updated_at: string;
}