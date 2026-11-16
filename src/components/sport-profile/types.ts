/** The sport profile's payload as the page reads it (GET /api/profile/[profileId]/sport-profile). Types only. */
import type { SportProfilePayload } from '@/lib/sport-profile/sport-profile-server';
import type { GolfProfilePayload } from '@/lib/sport-profile/golf-profile-server';

export type SportProfileData = SportProfilePayload & { supported: true; can_edit: boolean };
/** Golf's own payload (one wave, phase 3): scores against par, not stat lines. */
export type GolfProfileData = GolfProfilePayload & { supported: true; can_edit: boolean };
export type SportProfileAnswer = SportProfileData | GolfProfileData | { supported: false; sport: string };
export type SportGameRow = SportProfilePayload['games'][number];
export type StatColumn = SportProfilePayload['columns'][number];
