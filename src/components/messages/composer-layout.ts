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
