/**
 * Golf's form vocabulary — ONE set of control classes for both composer
 * paths (solo GolfScorecardForm + shared GolfComposerSection), matching the
 * app convention (see SportSettingsForm's CONTROL_CLASS).
 *
 * NO focus classes here or on any golf control: the app-wide :focus-visible
 * ring (globals.css) owns focus. Golf-green remains an ACCENT (headers,
 * selected fills, semantic score colors) — never input chrome.
 */
export const GOLF_INPUT =
  'w-full px-3 py-2 text-sm text-primary bg-surface border border-border-strong rounded-md placeholder:text-faint';
export const GOLF_INPUT_COMPACT =
  'w-full px-2 py-1.5 text-sm text-center text-primary bg-surface border border-border-strong rounded-md';
export const GOLF_SELECT = GOLF_INPUT;
export const GOLF_LABEL = 'block text-sm font-medium text-secondary mb-1';
export const GOLF_SECTION_CARD = 'bg-surface rounded-lg border border-border p-4';
