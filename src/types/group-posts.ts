/**
 * Group Posts Type Definitions
 * Sport-agnostic multi-participant activity system
 */

// ============================================
// CORE GROUP POST TYPES
// ============================================

export type GroupPostType =
  | 'golf_round'
  | 'hockey_game'
  | 'volleyball_match'
  | 'basketball_game'
  | 'social_event'
  | 'practice_session'
  | 'tournament_round'
  | 'watch_party';

export type GroupPostVisibility = 'public' | 'private' | 'participants_only';

export type GroupPostStatus = 'pending' | 'active' | 'completed' | 'cancelled';

export type ParticipantStatus = 'pending' | 'confirmed' | 'declined' | 'maybe';

export type ParticipantRole = 'creator' | 'participant' | 'organizer' | 'spectator';

export interface Profile {
  id: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  sport: string | null;
  school: string | null;
}

// ============================================
// GROUP POST
// ============================================

export interface GroupPost {
  id: string;
  creator_id: string;
  type: GroupPostType;
  title: string;
  description: string | null;
  date: string; // ISO date string
  location: string | null;
  visibility: GroupPostVisibility;
  status: GroupPostStatus;
  post_id: string | null; // Associated social post
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  creator?: Profile;
  participants?: GroupPostParticipant[];
  media?: GroupPostMedia[];
}

// ============================================
// GROUP POST PARTICIPANT
// ============================================

export interface GroupPostParticipant {
  id: string;
  group_post_id: string;
  profile_id: string;
  status: ParticipantStatus;
  role: ParticipantRole;
  attested_at: string | null;
  data_contributed: boolean;
  last_contribution: string | null;
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  profile?: Profile;
  group_post?: GroupPost;
}

// ============================================
// GROUP POST MEDIA
// ============================================

export type MediaType = 'image' | 'video';

export interface GroupPostMedia {
  id: string;
  group_post_id: string;
  uploaded_by: string;
  media_url: string;
  media_type: MediaType;
  caption: string | null;
  position: number;
  created_at: string;

  // Relations (when joined)
  uploader?: Profile;
}

// ============================================
// GOLF-SPECIFIC TYPES
// ============================================

export type RoundType = 'outdoor' | 'indoor';

export interface GolfScorecardData {
  id: string;
  group_post_id: string;
  course_name: string;
  course_id: string | null;
  round_type: RoundType;
  holes_played: number; // 1-18
  tee_color: string | null;
  slope_rating: number | null;
  course_rating: number | null;
  weather_conditions: string | null;
  temperature: number | null;
  wind_speed: number | null;
  created_at: string;
  updated_at: string;
}

export interface GolfParticipantScores {
  id: string;
  participant_id: string;
  entered_by: string | null;
  scores_confirmed: boolean;
  total_score: number | null;
  to_par: number | null;
  holes_completed: number;
  created_at: string;
  updated_at: string;

  // Relations (when joined)
  participant?: GroupPostParticipant;
  hole_scores?: GolfHoleScore[];
}

export interface GolfHoleScore {
  id: string;
  golf_participant_id: string;
  hole_number: number; // 1-18
  strokes: number; // 1-15
  putts: number | null; // 0-strokes
  fairway_hit: boolean | null;
  green_in_regulation: boolean | null;
  created_at: string;
  updated_at: string;
}

// ============================================
// API REQUEST/RESPONSE TYPES
// ============================================

// Create Group Post Request
export interface CreateGroupPostRequest {
  type: GroupPostType;
  title: string;
  description?: string;
  date: string;
  location?: string;
  visibility?: GroupPostVisibility;
  participant_ids?: string[];
}

// Update Group Post Request
export interface UpdateGroupPostRequest {
  title?: string;
  description?: string;
  date?: string;
  location?: string;
  visibility?: GroupPostVisibility;
  status?: GroupPostStatus;
}

// Add Participants Request
export interface AddParticipantsRequest {
  participant_ids: string[];
  role?: ParticipantRole;
}

// Attest Request
export interface AttestRequest {
  status: ParticipantStatus;
}

// Create Golf Scorecard Request
export interface CreateGolfScorecardRequest {
  group_post_id: string;
  course_name: string;
  course_id?: string;
  round_type: RoundType;
  holes_played: number;
  tee_color?: string;
  slope_rating?: number;
  course_rating?: number;
  weather_conditions?: string;
  temperature?: number;
  wind_speed?: number;
}

// Add Golf Scores Request
export interface AddGolfScoresRequest {
  scores: Array<{
    hole_number: number;
    strokes: number;
    putts?: number;
    fairway_hit?: boolean;
    green_in_regulation?: boolean;
  }>;
  entered_by?: string;
}

// Confirm Golf Scores Request
export interface ConfirmGolfScoresRequest {
  scores_confirmed: boolean;
}

// ============================================
// API RESPONSE TYPES
// ============================================

export interface GroupPostResponse {
  group_post: GroupPost;
  message?: string;
}

export interface GroupPostsListResponse {
  group_posts: GroupPost[];
  has_more: boolean;
  next_cursor: string | null;
}

export interface ParticipantsResponse {
  participants: GroupPostParticipant[];
}

export interface ParticipantResponse {
  participant: GroupPostParticipant;
  group_post?: Partial<GroupPost>;
  message?: string;
}

export interface GolfScorecardResponse {
  golf_data: GolfScorecardData;
  message?: string;
}

export interface GolfScoresResponse {
  golf_scores: GolfParticipantScores;
  inserted_count?: number;
  message?: string;
}

// ============================================
// COMPLETE GROUP POST WITH ALL DATA
// ============================================

export interface CompleteGroupPost extends GroupPost {
  creator: Profile;
  participants: Array<GroupPostParticipant & { profile: Profile }>;
  media: GroupPostMedia[];
  golf_data?: GolfScorecardData;
  golf_scores?: Array<GolfParticipantScores & { participant: GroupPostParticipant }>;
}

// ============================================
// COMPLETE GOLF SCORECARD (for display)
// ============================================

export interface CompleteGolfScorecard {
  group_post: GroupPost;
  golf_data: GolfScorecardData;
  participants: Array<{
    participant: GroupPostParticipant & { profile: Profile };
    scores: GolfParticipantScores & { hole_scores: GolfHoleScore[] };
  }>;
}

// ============================================
// UTILITY TYPES
// ============================================

// For filtering/querying
export interface GroupPostFilters {
  type?: GroupPostType;
  status?: GroupPostStatus;
  limit?: number;
  cursor?: string;
}

// For participant summary
export interface ParticipantSummary {
  total: number;
  confirmed: number;
  pending: number;
  declined: number;
  maybe: number;
}

// For golf statistics
export interface GolfStatsSummary {
  total_rounds: number;
  best_score: number | null;
  average_score: number | null;
  lowest_to_par: number | null;
}
