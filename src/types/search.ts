/**
 * Search Result Types
 * Centralized type definitions for search functionality across the application
 */

export interface SearchAthleteResult {
  id: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  location: string | null;
  sport: string | null;
  school: string | null;
  visibility?: string | null;
  handle?: string | null;
}

export interface SearchPostMedia {
  media_url: string;
  media_type: string;
}

export interface SearchPostProfile {
  id: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
}

export interface SearchPostResult {
  id: string;
  caption: string | null;
  sport_key: string | null;
  hashtags?: string[] | null;
  tags?: string[] | null;
  created_at: string;
  profile?: SearchPostProfile;
  post_media?: SearchPostMedia[];
}

export interface SearchClubResult {
  id: string;
  name: string;
  description?: string | null;
  location?: string | null;
}

export interface SearchResults {
  athletes: SearchAthleteResult[];
  posts: SearchPostResult[];
  clubs: SearchClubResult[];
}
