import { describe, it, expect } from 'vitest';
import {
  CHEVRON_PX,
  COMPOSER_MAX_HEIGHT,
  COMPOSER_MIN_HEIGHT,
  DOCK_SURFACE_WIDTH_PX,
  EMOJI_PANEL_HEIGHT_PX,
  EMOJI_PANEL_WIDTH_PX,
  GIF_POPOVER_MIN_VIEWPORT_PX,
  GIF_POPOVER_WIDTH_PX,
  LEADING_OPEN_PX,
  PICKER_GAP_PX,
  SURFACE_PADDING_X_PX,
  canSendMessage,
  composerLeadingReducer,
  composerTextareaHeight,
  gifPickerPresentation,
  initialLeadingOpen,
  pickerFitsSurface,
  type ComposerLeadingState,
} from '../composer-layout';

const open: ComposerLeadingState = { leadingOpen: true };
const collapsed: ComposerLeadingState = { leadingOpen: false };

describe('initialLeadingOpen', () => {
  it('mounts open with no draft', () => {
    expect(initialLeadingOpen()).toEqual(open);
    expect(initialLeadingOpen('')).toEqual(open);
  });

  it('mounts ALREADY collapsed when a dock draft is restored', () => {
    // Deriving this in an effect would show a visible expand->collapse flash
    // on every dock window that has a saved draft.
    expect(initialLeadingOpen('half a sentence')).toEqual(collapsed);
  });
});

describe('composerLeadingReducer', () => {
  it('collapses on the first character', () => {
    expect(composerLeadingReducer(open, { type: 'TEXT_CHANGED', text: 'h' })).toEqual(collapsed);
  });

  it('is a no-op for subsequent characters', () => {
    const next = composerLeadingReducer(collapsed, { type: 'TEXT_CHANGED', text: 'hello' });
    expect(next).toBe(collapsed); // same reference — no needless re-render
  });

  it('THE POLICY: backspacing to empty does NOT re-expand', () => {
    // This is the whole reason the state is explicit rather than derived from
    // text.length. If someone "simplifies" it to a derivation, this fails.
    const afterTyping = composerLeadingReducer(open, { type: 'TEXT_CHANGED', text: 'h' });
    const afterClearing = composerLeadingReducer(afterTyping, { type: 'TEXT_CHANGED', text: '' });
    expect(afterClearing).toEqual(collapsed);
  });

  it('stays open while the field is empty', () => {
    expect(composerLeadingReducer(open, { type: 'TEXT_CHANGED', text: '' })).toBe(open);
  });

  it('expands on chevron toggle, and re-collapses on the next keystroke', () => {
    const expanded = composerLeadingReducer(collapsed, { type: 'TOGGLE' });
    expect(expanded).toEqual(open);
    expect(composerLeadingReducer(expanded, { type: 'TEXT_CHANGED', text: 'x' })).toEqual(collapsed);
  });

  it('toggle also collapses an open cluster', () => {
    expect(composerLeadingReducer(open, { type: 'TOGGLE' })).toEqual(collapsed);
  });

  it('expands after a successful send', () => {
    // Send is the real session boundary — the full affordance comes back
    // without the user asking.
    expect(composerLeadingReducer(collapsed, { type: 'SENT' })).toEqual(open);
  });

  it('ignores unknown actions', () => {
    // @ts-expect-error deliberately invalid action
    expect(composerLeadingReducer(collapsed, { type: 'NOPE' })).toBe(collapsed);
  });
});

describe('layout constants', () => {
  it('the open cluster is exactly two chevron-widths', () => {
    // Both must track the w-10 classes in MessageInput; this pins the relationship.
    expect(CHEVRON_PX).toBe(40);
    expect(LEADING_OPEN_PX).toBe(CHEVRON_PX * 2);
  });
});

describe('composerTextareaHeight', () => {
  it('clamps to the min for a short single line', () => {
    expect(composerTextareaHeight(18)).toBe(COMPOSER_MIN_HEIGHT);
  });

  it('passes through a value inside the bounds', () => {
    expect(composerTextareaHeight(72)).toBe(72);
  });

  it('clamps to the max past ~5 lines', () => {
    expect(composerTextareaHeight(400)).toBe(COMPOSER_MAX_HEIGHT);
  });

  it('is safe on a non-finite measurement', () => {
    expect(composerTextareaHeight(Number.NaN)).toBe(COMPOSER_MIN_HEIGHT);
  });
});

describe('picker geometry budget', () => {
  const dock = {
    surfaceWidth: DOCK_SURFACE_WIDTH_PX,
    surfacePaddingX: SURFACE_PADDING_X_PX,
  };

  it('the emoji panel fits the 320px dock window, with 4px to spare', () => {
    // Budget is 320 - 16 = 304 (the right padding, counted once — the panel
    // floats over the LEFT padding, it just must not leave the window).
    expect(pickerFitsSurface({ ...dock, panelWidth: EMOJI_PANEL_WIDTH_PX })).toBe(true);
    expect(DOCK_SURFACE_WIDTH_PX - SURFACE_PADDING_X_PX - EMOJI_PANEL_WIDTH_PX).toBe(4);
  });

  it('the GIF popover fits the same window more comfortably', () => {
    expect(pickerFitsSurface({ ...dock, panelWidth: GIF_POPOVER_WIDTH_PX })).toBe(true);
  });

  it('rejects a panel that would leave the surface', () => {
    // The emoji panel clears by only 4px, so this is the guard: widen the panel
    // or the composer padding and a test fails instead of a user seeing spill.
    expect(pickerFitsSurface({ ...dock, panelWidth: 304 })).toBe(true);
    expect(pickerFitsSurface({ ...dock, panelWidth: 305 })).toBe(false);
    expect(pickerFitsSurface({ ...dock, panelWidth: 320 })).toBe(false);
  });

  it('a panel needs its height plus the gap above the field', () => {
    expect(EMOJI_PANEL_HEIGHT_PX + PICKER_GAP_PX).toBe(358);
  });
});

describe('gifPickerPresentation', () => {
  it('is a sheet below the sm breakpoint', () => {
    expect(gifPickerPresentation(375)).toBe('sheet');
    expect(gifPickerPresentation(GIF_POPOVER_MIN_VIEWPORT_PX - 1)).toBe('sheet');
  });

  it('is a popover at and above the sm breakpoint', () => {
    expect(gifPickerPresentation(GIF_POPOVER_MIN_VIEWPORT_PX)).toBe('popover');
    expect(gifPickerPresentation(1440)).toBe('popover');
  });

  it('defaults to the sheet for a zero/unknown width (SSR)', () => {
    expect(gifPickerPresentation(0)).toBe('sheet');
  });
});

describe('canSendMessage', () => {
  const base = { text: '', hasAttachment: false, hasGif: false, sending: false, disabled: false };

  it('rejects an empty composer', () => {
    expect(canSendMessage(base)).toBe(false);
  });

  it('rejects whitespace-only text', () => {
    expect(canSendMessage({ ...base, text: '   \n\t ' })).toBe(false);
  });

  it('accepts real text', () => {
    expect(canSendMessage({ ...base, text: 'hi' })).toBe(true);
  });

  it('accepts media with no caption', () => {
    // A photo or GIF on its own is a perfectly normal send.
    expect(canSendMessage({ ...base, hasAttachment: true })).toBe(true);
    expect(canSendMessage({ ...base, hasGif: true })).toBe(true);
  });

  it('blocks while sending or disabled, even with content', () => {
    expect(canSendMessage({ ...base, text: 'hi', sending: true })).toBe(false);
    expect(canSendMessage({ ...base, text: 'hi', disabled: true })).toBe(false);
  });
});
