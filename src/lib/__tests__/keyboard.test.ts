import { describe, it, expect } from 'vitest';
import { matchesSearchShortcut, isTypingTarget } from '../keyboard';

const key = (k: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) =>
  ({ key: k, ...mods });

describe('matchesSearchShortcut', () => {
  it('fires on ⌘K and Ctrl+K', () => {
    expect(matchesSearchShortcut(key('k', { metaKey: true }))).toBe(true);
    expect(matchesSearchShortcut(key('k', { ctrlKey: true }))).toBe(true);
    // A Mac user on an external PC keyboard presses Ctrl; a platform sniff
    // would leave them with no shortcut at all.
  });

  it('is case-insensitive, because Caps Lock exists', () => {
    expect(matchesSearchShortcut(key('K', { metaKey: true }))).toBe(true);
  });

  it('does NOT fire on a bare k — it has to stay a letter', () => {
    expect(matchesSearchShortcut(key('k'))).toBe(false);
  });

  it('leaves ⌘⇧K and ⌘⌥K alone — those belong to the browser', () => {
    expect(matchesSearchShortcut(key('k', { metaKey: true, shiftKey: true }))).toBe(false);
    expect(matchesSearchShortcut(key('k', { metaKey: true, altKey: true }))).toBe(false);
  });

  it('fires on an unmodified /', () => {
    expect(matchesSearchShortcut(key('/'))).toBe(true);
  });

  it('does not hijack modified /', () => {
    // ⌘/ and ⌥/ are other people's shortcuts (and ⌥/ types a character).
    expect(matchesSearchShortcut(key('/', { metaKey: true }))).toBe(false);
    expect(matchesSearchShortcut(key('/', { altKey: true }))).toBe(false);
  });

  it('ignores unrelated keys', () => {
    for (const k of ['j', 'Enter', 'Escape', 'ArrowLeft', ' ']) {
      expect(matchesSearchShortcut(key(k, { metaKey: true })), k).toBe(false);
    }
  });
});

describe('isTypingTarget', () => {
  // Cast at the boundary: the helper only ever reads three properties, and
  // building real DOM nodes is impossible here (node-only vitest, no jsdom).
  const el = (over: Record<string, unknown>) =>
    ({ getAttribute: () => null, ...over }) as unknown as EventTarget;

  it('recognises the text-entry elements', () => {
    // Without this, "/" would be unusable inside every caption and message
    // field in the app — the classic way a global shortcut turns hostile.
    expect(isTypingTarget(el({ tagName: 'INPUT' }))).toBe(true);
    expect(isTypingTarget(el({ tagName: 'TEXTAREA' }))).toBe(true);
    expect(isTypingTarget(el({ tagName: 'SELECT' }))).toBe(true);
  });

  it('is case-insensitive about tagName', () => {
    expect(isTypingTarget(el({ tagName: 'input' }))).toBe(true);
  });

  it('recognises contenteditable', () => {
    expect(isTypingTarget(el({ tagName: 'DIV', isContentEditable: true }))).toBe(true);
  });

  it('recognises custom controls by role', () => {
    for (const role of ['textbox', 'searchbox', 'combobox']) {
      expect(isTypingTarget(el({ tagName: 'DIV', getAttribute: () => role })), role).toBe(true);
    }
  });

  it('says no for ordinary elements and for nothing at all', () => {
    expect(isTypingTarget(el({ tagName: 'DIV' }))).toBe(false);
    expect(isTypingTarget(el({ tagName: 'BUTTON' }))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(undefined as unknown as EventTarget)).toBe(false);
  });

  it('survives an element with no getAttribute', () => {
    expect(isTypingTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false);
  });
});
