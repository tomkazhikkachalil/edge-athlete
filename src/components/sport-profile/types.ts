/** The sport profile's payload as the page reads it (GET /api/profile/[profileId]/sport-profile). Types only. */
import type { SportProfilePayload } from '@/lib/sport-profile/sport-profile-server';

export type SportProfileData = SportProfilePayload & { supported: true; can_edit: boolean };
export type SportProfileAnswer = SportProfileData | { supported: false; sport: string };
export type SportGameRow = SportProfilePayload['games'][number];
export type StatColumn = SportProfilePayload['columns'][number];
