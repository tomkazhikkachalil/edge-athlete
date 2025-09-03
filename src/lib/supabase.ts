import { createClient } from '@supabase/supabase-js';
import { createBrowserClient } from '@supabase/ssr';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing required Supabase environment variables');
  console.error('URL present:', !!supabaseUrl, 'Anon key present:', !!supabaseAnonKey);
}

// Client-side Supabase client (for browser use)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
}

export interface Club {
  id: string;
  name: string;
  description?: string;
  location?: string;
  created_at: string;
  updated_at: string;
}