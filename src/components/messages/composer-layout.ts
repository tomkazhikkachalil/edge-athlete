// Message-composer layout policy — pure, unit tested. The composer itself
// (MessageInput) owns all the DOM; this module owns the DECISIONS, so the
// contentious ones are executable assertions rather than comments that drift.
//
// The layout is iMessage's: the leading media buttons (attachment, GIF)
// collapse into a single chevron once you start typing, which is what actually
// frees the horizontal space on a 375px phone and in the 320px dock window.
// Emoji is deliberately NOT part of that cluster — it lives pinned inside the
// field's trailing edge in every state, because emoji is text entry while GIF
// and attachments are media insertion and get used far less often mid-typing.

/**
 * px widths of the leading slot in each state. These MUST track the `w-10`
 * classes on the chevron / paperclip / GIF buttons in MessageInput.
 *
 * They are explicit numbers for two reasons, both learned the hard way:
 * `auto` cannot be interpolated by a CSS transition (see the chat-dock morph,
 * DEVLOG 2026-07-28), and FontAwesome is an icon FONT — a padding-sized button
 * measures differently before and after the font loads, so a measured width
 * would be wrong on a cold cache.
 */
export const CHEVRON_PX = 40;
export const LEADING_OPEN_PX = 80;

/** Textarea auto-grow bounds, in px. ~5 lines at the desktop line height. */
export const COMPOSER_MIN_HEIGHT = 40;
export const COMPOSER_MAX_HEIGHT = 120;

// ── Picker geometry ─────────────────────────────────────────────────────────
// Both pickers anchor to the TEXT FIELD, not to their trigger button, so their
// right edge lines up with the field's and `bottom-full` tracks the field as it
// grows. The numbers below are the budget that makes that safe in the narrowest
// surface we ship (the 320px dock window) — they exist so widening a panel or
// the composer's padding breaks a test rather than a user.

export const EMOJI_PANEL_WIDTH_PX = 300;
export const EMOJI_PANEL_HEIGHT_PX = 350;
export const GIF_POPOVER_WIDTH_PX = 288; // Tailwind w-72
/** `mb-2` between a panel's bottom and the field's top. */
export const PICKER_GAP_PX = 8;

/** The narrowest surface a composer renders in: the dock mini window (w-80). */
export const DOCK_SURFACE_WIDTH_PX = 320;
/** The composer's horizontal padding on each side (`px-4`). */
export const SURFACE_PADDING_X_PX = 16;

/**
 * Does a panel of `panelWidth` fit inside a surface?
 *
 * The panel is a floating popover, NOT an in-flow child, so it may overhang the
 * composer's left padding — what it must not do is leave the surface. It is
 * right-aligned to the field's right edge, which sits one `surfacePaddingX` in
 * from the surface's right, so it spans leftward from there:
 *
 *     |<-------------- surfaceWidth -------------->|
 *     |  pad |            field             | pad  |
 *          [========= panel =========]<-- right edge aligned to the field
 *     ^ must not cross this edge
 *
 * Budget is therefore `surfaceWidth - surfacePaddingX`, counting the right
 * padding once — not the padding box.
 */
export function pickerFitsSurface({
  surfaceWidth,
  surfacePaddingX,
  panelWidth,
}: {
  surfaceWidth: number;
  surfacePaddingX: number;
  panelWidth: number;
}): boolean {
  return panelWidth <= surfaceWidth - surfacePaddingX;
}

/**
 * Below this the GIF picker stays a bottom sheet. Matches GifPickerModal's own
 * `sm:items-center` breakpoint, so under it we keep exactly the surface that
 * was designed for a phone with the keyboard up — where the visible viewport is
 * ~350px tall and a 360px popover above the composer would be off-screen.
 */
export const GIF_POPOVER_MIN_VIEWPORT_PX = 640;

export function gifPickerPresentation(viewportWidth: number): 'popover' | 'sheet' {
  return viewportWidth >= GIF_POPOVER_MIN_VIEWPORT_PX ? 'popover' : 'sheet';
}

export interface ComposerLeadingState {
  /** true = attachment + GIF visible; false = collapsed to the chevron. */
  leadingOpen: boolean;
}

export type ComposerLeadingAction =
  | { type: 'TEXT_CHANGED'; text: string }
  | { type: 'TOGGLE' }
  | { type: 'SENT' };

/**
 * Mount state. A restored dock draft is already non-empty, so the composer
 * must mount ALREADY collapsed — deriving this in an effect would show a
 * visible expand→collapse flash on every dock window that has a draft.
 */
export function initialLeadingOpen(initialText?: string): ComposerLeadingState {
  return { leadingOpen: (initialText ?? '').length === 0 };
}

/**
 * One-way latch: typing collapses, and emptying the field does NOT re-expand.
 *
 * This is the deliberate divergence from "just derive it from text.length".
 * Backspacing to empty is overwhelmingly a mid-edit event — fixing a typo or
 * restarting a sentence — not a decision to go attach a photo. Re-expanding
 * there yanks 40px out from under the caret and slides the send button while a
 * thumb is hovering it. The escape hatch is one tap on a chevron sitting
 * exactly where the buttons were; the cost of the alternative is a layout jump
 * on a keystroke.
 *
 * SENT is the compensating expand: sending is the real session boundary, so
 * the full affordance comes back without the user asking for it.
 */
export function composerLeadingReducer(
  state: ComposerLeadingState,
  action: ComposerLeadingAction
): ComposerLeadingState {
  switch (action.type) {
    case 'TEXT_CHANGED':
      // Collapse on the first character; never re-open here.
      if (action.text.length > 0 && state.leadingOpen) {
        return { leadingOpen: false };
      }
      return state;
    case 'TOGGLE':
      return { leadingOpen: !state.leadingOpen };
    case 'SENT':
      return { leadingOpen: true };
    default:
      return state;
  }
}

/** Clamp a measured scrollHeight into the composer's growth bounds. */
export function composerTextareaHeight(scrollHeight: number): number {
  if (!Number.isFinite(scrollHeight)) return COMPOSER_MIN_HEIGHT;
  return Math.max(COMPOSER_MIN_HEIGHT, Math.min(scrollHeight, COMPOSER_MAX_HEIGHT));
}

export interface CanSendInput {
  text: string;
  hasAttachment: boolean;
  hasGif: boolean;
  sending: boolean;
  disabled: boolean;
}

/**
 * Send policy. Whitespace-only text is not a message, but media on its own is
 * — a photo or GIF with no caption is a perfectly normal send.
 */
export function canSendMessage({
  text,
  hasAttachment,
  hasGif,
  sending,
  disabled,
}: CanSendInput): boolean {
  const hasContent = text.trim().length > 0 || hasAttachment || hasGif;
  return hasContent && !sending && !disabled;
}
