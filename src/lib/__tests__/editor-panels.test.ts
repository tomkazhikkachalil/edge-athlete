import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// The editor's three "advanced" panels in plain words (Nov 6 2026, PR B of
// the photo editor pass). The rules: an item's Remove button sits OUTSIDE the
// chips' scrolling strip (it used to scroll off a phone screen once two items
// existed); the add buttons have their own row; a mask is a Circle, a
// Gradient, Paint or the Subject to the person (the recipe kinds stay
// radial / linear / brush / data); Feather is "Soft edge", Invert is
// "Outside", Pill is "Backdrop"; the text field can be emptied while typing.

const DIR = join(__dirname, '..', '..', 'components', 'media-editor');
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');

describe('Remove is never behind a scroll', () => {
  for (const file of ['MaskPanel.tsx', 'RetouchPanel.tsx', 'TextPanel.tsx']) {
    it(`${file}: the chips scroll in their own strip, Remove beside it`, () => {
      const source = read(file);
      const strip = source.indexOf('flex-1 min-w-0 flex items-center gap-2 overflow-x-auto scrollbar-hide');
      const remove = source.indexOf('>\n              Remove\n            </button>');
      expect(strip, 'the strip').toBeGreaterThan(-1);
      expect(remove, 'Remove').toBeGreaterThan(strip);
      // Remove is no longer pushed to the end of a scrolling row.
      expect(source).not.toContain('ml-auto px-3 min-h-[36px] rounded-full text-chip shrink-0 text-white/70');
    });
  }
});

describe('masks in plain words', () => {
  const panel = read('MaskPanel.tsx');
  const overlay = read('MaskOverlay.tsx');
  it('names the kinds Circle / Gradient / Paint / Subject over the same recipe kinds', () => {
    expect(panel).toContain("radial: 'Circle'");
    expect(panel).toContain("linear: 'Gradient'");
    expect(panel).toContain("brush: 'Paint'");
    expect(panel).toContain("data: 'Subject'");
    for (const label of ['+ Circle', '+ Gradient', '+ Paint', '✦ Subject']) expect(panel).toContain(label);
    for (const old of ['+ Radial', '+ Linear', '+ Brush', '✦ Select subject']) expect(panel).not.toContain(old);
    // The overlay's shapes carry the same words, distinct from the chips.
    expect(overlay).toContain('`Circle mask ${i + 1}`');
    expect(overlay).toContain('`Gradient mask ${i + 1}`');
    expect(overlay).toContain('`Paint mask ${i + 1}`');
    expect(overlay).not.toContain('Radial mask');
  });
  it('says Soft edge and Outside, keeps the history keys, and adds a hint per kind', () => {
    expect(panel).toContain('label="Soft edge"');
    expect(panel).not.toContain('label="Feather"');
    expect(panel).toContain('Outside\n');
    expect(panel).not.toContain('>\n                  Invert\n');
    expect(panel).toContain('`mask.${selectedIndex}.feather`');
    expect(panel).toContain('`mask.${selectedIndex}.invert`');
    expect(panel).toContain('const MASK_HINTS: Record<Mask[\'kind\'], string>');
    expect(panel).toContain('Edit part of the photo.');
    expect(panel).toContain('>Effect</p>');
  });
});

describe('retouch and text in plain words', () => {
  it('retouch: one short hint, Soft edge, the same keys', () => {
    const panel = read('RetouchPanel.tsx');
    expect(panel).toContain('Tap a spot on the photo to hide it. Drag the dashed circle to choose what covers it.');
    expect(panel).toContain('label="Soft edge"');
    expect(panel).toContain('`clone.${selectedIndex}.feather`');
  });
  it('text: "+ Text" focuses the field with its words selected; the field can be emptied; Pill is Backdrop', () => {
    const panel = read('TextPanel.tsx');
    expect(panel).toContain('focusNextRef.current = true;');
    expect(panel).toContain('inputRef.current?.select();');
    expect(panel).toContain("const [draft, setDraft] = useState<{ index: number; value: string } | null>(null);");
    expect(panel).toContain('if (content.length > 0) {');
    expect(panel).not.toContain('if (content.length === 0) return;');
    expect(panel).toContain('Backdrop\n');
    expect(panel).toContain('`overlay.${selectedIndex}.pill`');
    expect(panel).toContain('Or type any emoji');
  });
});
