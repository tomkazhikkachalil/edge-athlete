/**
 * The Create sheet's six options (tile grid with info, Nov 23 2026) — Tom's
 * spec "Create Sheet Redesign": titles only, the description behind an info
 * button. Order and destinations are the Nov 20 six doors, unchanged; the
 * titles are this sheet's own (Training's Start keeps "Workout" /
 * "Activity"). `key` is the option's hook: `data-create-<key>`.
 *
 * Zero imports: the list and the one rule for the info state are pinned by
 * `create-options.test.ts`; `CreateSheet.tsx` only draws them.
 */
export type CreateOptionKey = 'post' | 'sport' | 'workout' | 'recording' | 'event' | 'full-game';

/** hero = the full-width Post button; tile = the 2 x 2 grid; row = the full-width last row. */
export type CreateOptionShape = 'hero' | 'tile' | 'row';

export interface CreateOption {
  key: CreateOptionKey;
  title: string;
  info: string;
  shape: CreateOptionShape;
}

export const CREATE_OPTIONS: readonly CreateOption[] = [
  { key: 'post', title: 'Post', info: 'Share text, photos and video.', shape: 'hero' },
  { key: 'sport', title: 'Sport session', info: 'Pick a sport and start a session, like a golf round.', shape: 'tile' },
  { key: 'workout', title: 'Gym workout', info: 'Log sets, reps and weight, with a rest timer, supersets and circuits.', shape: 'tile' },
  { key: 'recording', title: 'Live activity', info: 'Track a run, ride, yoga session or climb live, with a timer or a map.', shape: 'tile' },
  { key: 'event', title: 'Event & leaderboard', info: 'Invite players, go live and keep a leaderboard.', shape: 'tile' },
  { key: 'full-game', title: 'Game highlights', info: 'Link a YouTube game or tournament and mark the highlights.', shape: 'row' },
];

/**
 * A tap on an info button: the same option closes, another one takes its
 * place — so at most one info text is ever open.
 */
export function toggleInfo(open: CreateOptionKey | null, tapped: CreateOptionKey): CreateOptionKey | null {
  return open === tapped ? null : tapped;
}

/** How long a picked option shows as selected before its flow opens. */
export const CREATE_PICK_BEAT_MS = 150;
