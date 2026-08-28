// Shared visibility / messaging-permission option lists, so the family
// console's Safety section and the post-transfer activation review card
// describe the same choices with the same words. Extracted from
// src/app/activate/[token]/page.tsx (which now imports from here).

export type Visibility = 'public' | 'private';
export type MessagingPermission = 'everyone' | 'fans_only' | 'mutual_fans' | 'nobody';

export interface PrivacyOption<V extends string> {
  value: V;
  label: string;
  description: string;
}

export const MESSAGING_OPTIONS: PrivacyOption<MessagingPermission>[] = [
  { value: 'everyone', label: 'Everyone', description: 'Any Edge Athlete user can send you a direct message.' },
  { value: 'fans_only', label: 'Fans only', description: 'Only athletes who follow you can send you messages.' },
  { value: 'mutual_fans', label: 'Mutual fans', description: 'Only athletes you both follow each other can message you.' },
  { value: 'nobody', label: 'Nobody', description: 'Direct messages stay off. No one can message you.' },
];

export const VISIBILITY_OPTIONS: PrivacyOption<Visibility>[] = [
  { value: 'private', label: 'Private', description: 'Only approved followers can see the profile, posts and stats. People must send a follow request.' },
  { value: 'public', label: 'Public', description: 'Anyone can see the profile, posts and stats, and it may appear in search results.' },
];

// Guardian comment-moderation toggle (095) — supervised athletes only.
export type CommentModeration = 'instant' | 'held';

export const COMMENT_MODERATION_OPTIONS: PrivacyOption<CommentModeration>[] = [
  { value: 'held', label: 'Held for your review', description: 'Comments they write stay invisible until you approve them in the approvals queue.' },
  { value: 'instant', label: 'Instant', description: 'Comments they write appear immediately, like posts from any other athlete.' },
];

// Value lists DERIVED from the option arrays (Wave 4) — the one source both
// the UI options and every server-side whitelist validate against, so the
// two can never diverge. (The athlete-safety PATCH and the household-policy
// parser both consume these; the PATCH's former local copies are gone.)
export const VISIBILITY_VALUES: Visibility[] = VISIBILITY_OPTIONS.map(o => o.value);
export const MESSAGING_VALUES: MessagingPermission[] = MESSAGING_OPTIONS.map(o => o.value);
export const COMMENT_MODERATION_VALUES: CommentModeration[] = COMMENT_MODERATION_OPTIONS.map(o => o.value);
