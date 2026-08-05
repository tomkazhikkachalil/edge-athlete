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
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
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
  onboarded_at?: string | null; // null = first-run onboarding not yet completed
  created_at: string;
  updated_at: string;
  // Extended athlete profile fields
  middle_name?: string;
  username?: string; // DEPRECATED: No longer used
  full_name?: string; // Fallback display name (NOT a handle - use 'handle' field instead)
  handle?: string; // Unique @handle identifier (user-editable @username)
  bio?: string;
  sport?: string;
  position?: string; // Note: Not in current DB schema, reserved for future use
  school?: string;
  team?: string; // Note: Not in current DB schema, reserved for future use
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
  cover_url?: string;
  // Privacy settings
  visibility?: 'public' | 'private';
  // Guardian-profiles: 'supervised' while a guardian manages the account,
  // 'self' after the transfer of control completes.
  supervision_state?: 'self' | 'supervised' | string;
  dob_locked?: boolean;
  // Note: Sport-specific settings (golf, hockey, etc.) are now stored in the sport_settings table
}

// AthleteBadge was deleted August 2026 — no surface renders athlete_badges
// anymore (profile pills read real rows from /api/achievements). The table
// remains; account-deletion and storage-sweep reference it by name.

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
  content: string | null;
  gif_url?: string | null;
  created_at: string;
  updated_at: string;
  likes_count?: number;
  is_pinned?: boolean;
  profile?: Profile;
  comment_likes?: { profile_id: string }[];
}

// Generic sport settings (stored in database).
//
// The per-sport SHAPE of `settings` is not declared here. It used to be —
// one hand-written interface per sport (GolfSettings/HockeySettings/
// BasketballSettings) that nothing imported and that drifted from the form
// actually writing the rows. The schemas in
// `src/lib/sports/settings-schemas.ts` are now the single source of truth
// for both the fields and their coercion; adding a sport touches only that
// file. Keep this row type shape-agnostic so it never needs editing again.
export interface SportSettings {
  id: string;
  profile_id: string;
  sport_key: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}