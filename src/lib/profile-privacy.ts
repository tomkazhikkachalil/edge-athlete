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
