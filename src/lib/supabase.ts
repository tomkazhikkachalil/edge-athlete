import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required Supabase environment variables');
  console.error('URL present:', !!supabaseUrl, 'Anon key present:', !!supabaseAnonKey);
}

console.log('Supabase configuration:');
console.log('- URL present:', !!supabaseUrl);
console.log('- Anon key present:', !!supabaseAnonKey);
console.log('- Service role key present:', !!supabaseServiceRoleKey);

// Client-side Supabase client (for browser use) with optimized auth settings
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    flowType: 'pkce', // More secure and faster
  },
  global: {
    headers: {
      'x-client-info': 'edge-athlete@1.0.0',
    },
  },
  db: {
    schema: 'public',
  },
  realtime: {
    params: {
      eventsPerSecond: 10,
    },
  },
});

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
  gender?: 'male' | 'female' | 'custom';
  location?: string;
  postal_code?: string;
  user_type: 'athlete' | 'club' | 'league' | 'fan';
  created_at: string;
  updated_at: string;
  // Extended athlete profile fields
  username?: string;
  full_name?: string;
  bio?: string;
  height_cm?: number;
  weight_kg?: number;
  weight_display?: number;
  weight_unit?: 'lbs' | 'kg' | 'stone';
  dob?: string;
  class_year?: number;
  social_twitter?: string;
  social_instagram?: string;
  social_facebook?: string;
  avatar_url?: string;
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