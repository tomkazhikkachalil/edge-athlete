/**
 * Post and Media Types
 * Centralized type definitions for posts, comments, and media
 */

import { Profile } from '@/lib/supabase';

export interface PostMedia {
  id: string;
  post_id: string;
  media_url: string;
  media_type: 'image' | 'video';
  caption?: string | null;
  position: number;
  created_at: string;
}

export interface PostTag {
  id: string;
  post_id: string;
  profile_id: string;
  created_at: string;
  profile?: Profile;
}

export interface GolfRoundData {
  id: string;
  profile_id: string;
  course_name: string;
  course_id?: string | null;
  date: string;
  total_score: number;
  round_type: 'outdoor' | 'indoor';
  tee_color?: string | null;
  weather_conditions?: string | null;
  temperature?: number | null;
  wind_speed?: number | null;
  notes?: string | null;
  stats?: {
    pars?: number;
    birdies?: number;
    eagles?: number;
    bogeys?: number;
    double_bogeys?: number;
    total_putts?: number;
  };
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  profile_id: string;
  caption: string | null;
  sport_key: string | null;
  visibility: 'public' | 'private';
  hashtags?: string[] | null;
  tags?: string[] | null;
  created_at: string;
  updated_at: string;
  likes_count: number;
  comments_count: number;
  saves_count: number;
  round_id?: string | null;
  // Joined relations
  profile?: Profile;
  post_media?: PostMedia[];
  post_tags?: PostTag[];
  golf_rounds?: GolfRoundData;
  post_likes?: { profile_id: string }[];
  saved_posts?: { profile_id: string }[];
}
