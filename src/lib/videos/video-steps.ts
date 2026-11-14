/**
 * The "link a full game" flow as steps (Videos program, 296) — pure, zero
 * imports. StepFlow draws the frame; this says what the steps are and when
 * Next is refused (and why — a dead button with no reason reads as broken).
 */
export const VIDEO_STEPS = [
  { id: 'link', label: 'Link' },
  { id: 'details', label: 'Details' },
  { id: 'where', label: 'Where' },
] as const;

export type VideoStepId = (typeof VIDEO_STEPS)[number]['id'];

export interface VideoStepState {
  /** The pasted link parsed to an id, or null. */
  videoId: string | null;
  /** The person typed something that is not a link we play. */
  linkTyped: boolean;
  title: string;
  owner: 'me' | { orgId: string } | null;
  /** Paste and go: YouTube said the video cannot play here for anyone (a private video) — the sentence to show. */
  blocked?: string | null;
  /** Only the connected channel (Nov 11 2026): the video is not the owner's connected channel's (or no channel is connected) — the sentence to show. Refuses Link AND Where (the owner is chosen there). */
  channelBlocked?: string | null;
  /** The person manages a club or league too, so the owner can still change at Where: Link lets them through (the sentence shows as a note) and Where is the refusal. Never a dead end for someone adding a club's game without a channel of their own. */
  canChangeOwner?: boolean;
  /** Round 2 (Nov 13 2026): "This is a game" is on and no sport is chosen — the game cannot be saved without one. */
  gameNeedsSport?: boolean;
}

export function canAdvanceVideoStep(step: VideoStepId, s: VideoStepState): { ok: true } | { ok: false; refusal: string } {
  if (step === 'link') {
    if (s.videoId && s.blocked) return { ok: false, refusal: s.blocked };
    if (s.videoId && s.channelBlocked && !s.canChangeOwner) return { ok: false, refusal: s.channelBlocked };
    if (s.videoId) return { ok: true };
    return { ok: false, refusal: s.linkTyped ? 'That is not a YouTube video link we can play.' : 'Paste a YouTube link to continue.' };
  }
  if (step === 'details') return s.gameNeedsSport ? { ok: false, refusal: 'Choose the sport of the game, or turn "This is a game" off.' } : { ok: true };
  if (s.owner === null) return { ok: false, refusal: 'Choose where the video goes.' };
  if (s.channelBlocked) return { ok: false, refusal: s.channelBlocked };
  return { ok: true };
}
