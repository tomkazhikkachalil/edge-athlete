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
}

export function canAdvanceVideoStep(step: VideoStepId, s: VideoStepState): { ok: true } | { ok: false; refusal: string } {
  if (step === 'link') {
    if (s.videoId && s.blocked) return { ok: false, refusal: s.blocked };
    if (s.videoId) return { ok: true };
    return { ok: false, refusal: s.linkTyped ? 'That is not a YouTube video link we can play.' : 'Paste a YouTube link to continue.' };
  }
  if (step === 'details') return { ok: true };
  if (s.owner === null) return { ok: false, refusal: 'Choose where the video goes.' };
  return { ok: true };
}
