import { supabase } from './supabase';
import type {
  Profile,
  Sport,
  SeasonHighlight,
  Performance
} from './supabase';

export class AthleteService {
  // Profile operations
  static async getAthleteProfile(profileId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', profileId)
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  static async updateAthleteProfile(profileId: string, updates: Partial<Profile>): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', profileId)
      .select()
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // Badge operations were deleted August 2026: `getBadges` fabricated three
  // sample badges for every athlete with an empty athlete_badges table, and
  // every display surface now reads real rows from /api/achievements. The
  // table itself remains (account-deletion and storage-sweep still cover it).

  // Sports operations
  static async getSports(profileId: string): Promise<Sport[]> {
    const { data, error } = await supabase
      .from('sports')
      .select('*')
      .eq('profile_id', profileId)
      .eq('active', true);

    if (error) {
      return [];
    }

    return data || [];
  }

  static async createSport(sport: Omit<Sport, 'id' | 'created_at' | 'updated_at'>): Promise<Sport | null> {
    const { data, error } = await supabase
      .from('sports')
      .insert(sport)
      .select()
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // Season highlights operations
  static async getSeasonHighlights(profileId: string, limit = 3): Promise<SeasonHighlight[]> {
    const { data, error } = await supabase
      .from('season_highlights')
      .select('*')
      .eq('profile_id', profileId)
      .order('season', { ascending: false })
      .limit(limit);

    if (error) {
      console.error('Failed to fetch season highlights:', error.message);
    }

    // No fabricated sample rows — an empty result is an empty result
    // (calculateAthleticScore falls back to base + profile completeness).
    return data || [];
  }

  static async createSeasonHighlight(highlight: Omit<SeasonHighlight, 'id' | 'created_at' | 'updated_at'>): Promise<SeasonHighlight | null> {
    const { data, error } = await supabase
      .from('season_highlights')
      .insert(highlight)
      .select()
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // Performance operations
  static async getRecentPerformances(profileId: string, limit = 10): Promise<Performance[]> {
    const { data, error } = await supabase
      .from('performances')
      .select('*')
      .eq('profile_id', profileId)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      return [];
    }

    return data || [];
  }

  static async createPerformance(performance: Omit<Performance, 'id' | 'created_at' | 'updated_at'>): Promise<Performance | null> {
    const { data, error } = await supabase
      .from('performances')
      .insert(performance)
      .select()
      .single();

    if (error) {
      return null;
    }

    return data;
  }

  // Utility functions for empty states
  static getEmptyProfile(): Partial<Profile> {
    return {
      full_name: '—',
      bio: 'Add a bio to tell your story...',
      location: '—',
      height_cm: undefined,
      weight_kg: undefined,
      class_year: undefined,
      social_twitter: undefined,
      social_instagram: undefined,
      social_facebook: undefined,
    };
  }

  static getEmptyHighlights(): SeasonHighlight[] {
    return [];
  }

  static getEmptyPerformances(): Performance[] {
    return [];
  }

  // Helper functions
  static formatHeight(heightCm?: number): string {
    if (!heightCm) return '—';
    const feet = Math.floor(heightCm / 30.48);
    const inches = Math.round((heightCm % 30.48) / 2.54);
    return `${feet}'${inches}"`;
  }

  static formatWeight(weightKg?: number): string {
    if (!weightKg) return '—';
    const pounds = Math.round(weightKg * 2.20462);
    return `${pounds} lbs`;
  }

  static formatAge(dob?: string): string {
    if (!dob) return '—';
    const birthDate = new Date(dob);
    const today = new Date();
    const age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();
    
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
      return `${age - 1}`;
    }
    
    return `${age}`;
  }

  static formatDate(dateString: string): string {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  }
}