import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The iOS focus-zoom guard (Oct 22 2026). Tom's iPhone: after a cold open,
// Create → Sport zoomed the screen to the far left — the sport picker's
// search field auto-focused from inside the composer's lazily loaded chunk,
// AFTER the tap, and the 16 px rule covered only typed inputs at ≤ 640 px.
// Two rules, read from the source:
//  1. every text control is 16 px on a touch screen (unlayered, beats text-sm);
//  2. a field that can mount outside a tap focuses only behind a fine pointer;
//     every other `autoFocus` site is listed here — a new one fails until it
//     is reviewed against the rule (fine inside a tap; never from a lazy mount).
// Page zoom is never disabled.
const ROOT = process.cwd();
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const code = (f: string) => read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(p, out);
    } else if (entry.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('the iOS focus-zoom guard', () => {
  it('every text control is 16 px on every touch screen, whatever its type or the width', () => {
    const css = read('src/app/globals.css');
    const block = css.match(/@media \(max-width: 640px\), \(pointer: coarse\) \{([\s\S]*?)\n\}/);
    expect(block, 'the guard block').toBeTruthy();
    const body = block![1];
    expect(body).toMatch(/input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\):not\(\[type="range"\]\):not\(\[type="file"\]\)/);
    expect(body).toMatch(/:not\(\[type="hidden"\]\),\s*textarea,\s*select \{\s*font-size: 16px;/);
    // Unlayered: the block is not inside an @layer (Tailwind layers text-sm / text-xs).
    const before = css.slice(0, css.indexOf('@media (max-width: 640px), (pointer: coarse)'));
    const opens = (before.match(/@layer [^;{]*\{/g) ?? []).length;
    expect(opens, 'the guard sits outside every @layer block').toBe(0);
    // The old typed-only form is gone.
    expect(css).not.toMatch(/@media \(max-width: 640px\) \{\s*input\[type="text"\]/);
  });

  it('page zoom stays allowed', () => {
    const layout = read('src/app/(app)/layout.tsx');
    expect(layout).toMatch(/maximumScale: 5/);
    expect(layout).not.toMatch(/userScalable: false|maximumScale: 1\b/);
  });

  it('the sport picker focuses its search only on a fine pointer, without scrolling, and is 16 px at every width', () => {
    const picker = code('src/components/SportSelector.tsx');
    expect(picker).not.toMatch(/autoFocus/);
    expect(picker).toMatch(/window\.matchMedia\('\(hover: hover\) and \(pointer: fine\)'\)\.matches/);
    expect(picker).toMatch(/searchRef\.current\?\.focus\(\{ preventScroll: true \}\)/);
    expect(picker).toMatch(/ref=\{searchRef\}/);
    expect(picker).toMatch(/py-2 text-base border/);
    expect(picker).toMatch(/data-sport-search=""/);
  });

  it('every autoFocus site is known (a new one is reviewed: inside a tap is fine; never from a lazy mount on a phone)', () => {
    const known = [
      'src/app/(app)/athlete/page.tsx',            // the bio / handle fields, opened by a tap
      'src/components/AddBodyMetricModal.tsx',     // a modal opened by a tap
      'src/components/GifPicker.tsx',              // opened by a tap
      'src/components/chat-dock/DockComposer.tsx',
      'src/components/chat-dock/DockGroupComposer.tsx',
      'src/components/media-editor/FilterStrip.tsx',
      'src/components/media/MediaLightbox.tsx',    // a button, not a field
      'src/components/messages/ChatWindow.tsx',    // passes the prop
      'src/components/messages/MessageInput.tsx',  // the prop, focused in an effect
      'src/components/messages/NewConversationModal.tsx',
      'src/components/workouts/ExerciseCard.tsx',  // the rename field, opened by a tap
    ].sort();
    const found = [...walk(path.join(ROOT, 'src/components')), ...walk(path.join(ROOT, 'src/app'))]
      .filter(f => /\bautoFocus\b(?!Search)/.test(code(path.relative(ROOT, f))))
      .map(f => path.relative(ROOT, f))
      .sort();
    expect(found).toEqual(known);
  });
});
