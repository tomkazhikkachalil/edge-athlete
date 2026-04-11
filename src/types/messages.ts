export type ConversationType = 'direct' | 'group';
export type MessageType = 'text' | 'image' | 'video' | 'shared_post' | 'shared_profile';
export type ParticipantRole = 'admin' | 'member';
export type MessagingPermission = 'everyone' | 'fans_only' | 'mutual_fans' | 'nobody';

export interface ParticipantProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

export interface ConversationParticipant {
  id: string;
  conversation_id: string;
  profile_id: string;
  role: ParticipantRole;
  last_read_at: string | null;
  is_muted: boolean;
  joined_at: string;
  left_at: string | null;
  profile: ParticipantProfile;
}

export interface SharedPostPreviewData {
  id: string;
  caption: string | null;
  created_at: string;
  profile: ParticipantProfile;
  media: { media_url: string; media_type: string }[];
}

export interface SharedProfilePreviewData {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
  bio: string | null;
  sport: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  type: MessageType;
  content: string | null;
  media_url: string | null;
  media_type: 'image' | 'video' | null;
  shared_post_id: string | null;
  shared_profile_id: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  sender: ParticipantProfile;
  shared_post?: SharedPostPreviewData | null;
  shared_profile?: SharedProfilePreviewData | null;
}

export interface Conversation {
  id: string;
  type: ConversationType;
  name: string | null;
  avatar_url: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  participants: ConversationParticipant[];
  last_message: Message | null;
  unread_count: number;
  my_participant: ConversationParticipant;
}
