/**
 * The recording mode (Events program, phase 4, 214) — pure. Two facts on
 * the rows decide who enters what: `sport_events.self_entry` ("players
 * enter their own") and `sport_event_participants.recorder` (a named
 * recorder — on ANY accepted row: a player, a co-organizer, or a follower,
 * the non-playing recorder). The MODE is derived, never stored: no CHECK,
 * no impossible state (a "recorder" mode with nobody named).
 */
export type RecordingMode = 'self' | 'recorder' | 'both';

export function recordingModeOf(event: { self_entry: boolean }, rows: ReadonlyArray<{ recorder: boolean; status: string }>): RecordingMode {
  const anyRecorder = rows.some(r => r.recorder && r.status === 'accepted');
  if (event.self_entry) return anyRecorder ? 'both' : 'self';
  return 'recorder';
}

export const RECORDING_MODE_LABEL: Readonly<Record<RecordingMode, string>> = {
  self: 'Players enter their own scores',
  recorder: 'A recorder enters the scores',
  both: 'Players enter their own; recorders may enter for anyone',
};

/** The wizard's three-way choice → the one stored fact. */
export function selfEntryFor(choice: 'self' | 'recorder' | 'both'): boolean {
  return choice !== 'recorder';
}
