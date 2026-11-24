import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// The sport picker (Tom's spec, Oct 27 2026; migration 285): search first,
// Favourites per account, All Sports alphabetical, no "General Post" and
// nothing pre-selected. This pins the row contract the e2e specs lean on —
// the pure rules live in src/lib/sports/favourite-sports.ts and its test.

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

describe('the sport picker rows', () => {
  const picker = read('components/SportSelector.tsx');

  it('offers no General Post and pre-selects nothing', () => {
    expect(picker).not.toContain('General Post');
    expect(picker).not.toContain('selectedSport');
    expect(picker).not.toContain('fa-check-circle');
  });

  it('a star is a SIBLING button whose accessible name never carries the sport', () => {
    // The two exact names, never a template — so `getByRole('button', { name: /golf/i })`
    // still finds exactly ONE button (the row) in every spec.
    expect(picker).toContain(`aria-label={isFavourite ? 'Remove from favourites' : 'Add to favourites'}`);
    expect(picker).toMatch(/aria-describedby=\{nameId\}/);
    expect(picker).toMatch(/aria-pressed=\{isFavourite\}/);
    expect(picker).toMatch(/data-sport-favourite=\{sport\.sport_key\}/);
    // Nested buttons are invalid HTML and a tap on the star would pick the sport:
    // the row button closes before the star button opens.
    const row = picker.indexOf('<button\n        type="button"\n        onClick={() => onSelect(sport)}');
    const rowClose = picker.indexOf('</button>', row);
    const star = picker.indexOf('data-sport-favourite=');
    expect(row).toBeGreaterThan(-1);
    expect(rowClose).toBeGreaterThan(row);
    expect(star).toBeGreaterThan(rowClose);
  });

  it('the sections come from the one rule module and the switch is gold by token', () => {
    expect(picker).toContain("from '@/lib/sports/favourite-sports'");
    // The SECTION follows the stored list a beat late (the tile slides in
    // after the switch has moved); the switch itself reads the stored list.
    expect(picker).toContain('partitionSports(getAllSports(), shown.keys, searchQuery)');
    expect(picker).toContain('isFavourite={favourites.includes(sport.sport_key)}');
    expect(picker).toContain('data-sport-favourites=""');
    // Nov 23 2026 (the mechanical dialect): the star is a switch; its gold
    // is a token with a light and a dark value, never a literal at the site.
    expect(picker).toContain('ea-mech-fav-track');
    expect(picker).not.toMatch(/#[0-9a-fA-F]{6}/);
    const css = read('app/globals.css');
    expect(css).toMatch(/\[aria-pressed="true"\] > \.ea-mech-fav-track > \.ea-mech-fav-knob \{\s*background-color: var\(--mech-gold\);/);
    expect((css.match(/^\s*--mech-gold: #[0-9a-f]{6};/gm) ?? []).length, 'a light and a dark value').toBe(2);
  });

  it('a tile is the mechanical tile: LAST from the account, SOON in place of the switch, the scope on the overlay', () => {
    expect(picker).toContain('className="ea-mech ea-mech-overlay fixed inset-0');
    expect(picker).toContain('z-[60]'); // the specs find the picker by its layer
    expect(picker).toContain('grid grid-cols-3 sm:grid-cols-5 gap-2');
    expect(picker).toContain('useLastSport()');
    expect(picker).toContain('data-sport-last=""');
    expect(read('hooks/useLastSport.ts')).toContain("fetch('/api/settings/last-sport'");
    const route = read('app/api/settings/last-sport/route.ts');
    expect(route).toContain("'Cache-Control': 'private, no-store'");
    expect(route).toContain(".eq('profile_id', user.id)");
  });

  it('a gold star is its own confirmation — the hook shows no notice', () => {
    const hook = read('hooks/useFavouriteSports.ts');
    expect(hook).not.toMatch(/showNotice|showUndo/);
    expect(hook).toContain('showError(');
    expect(hook).toContain("fetch('/api/settings/favourite-sports'");
  });

  it('favourites never leave the owner: the profile read strips them', () => {
    expect(read('app/api/profile/route.ts')).toMatch(/OWNER_ONLY_FIELDS = \[[^\]]*'favourite_sports'/);
  });

  it('the composer keeps the way back to General beside the Post Type row', () => {
    const composer = read('components/CreatePostModal.tsx');
    expect(composer).toContain('data-post-type-clear=""');
    expect(composer).not.toContain('selectedSport={postType}');
  });
});
