import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Convention 52 (Oct 25 2026): the own profile is a profile, not a settings
// form. The owner sees the visitor's read-only view plus ONE Edit Profile
// control; every profile FIELD is edited in Edit Profile (Save and Close both
// return to the profile); the profile carries no inline editor, no "add
// your …" prompt and no empty-slot nudge. Owner ACTIONS (Create Post, the
// sport pins, the tabs' Add / Start / Log, the photo Edit door on a SET
// photo) are not editing and stay. Read from the source.
const ROOT = process.cwd();
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('the own profile is a profile, not a settings form', () => {
  const own = code('src/app/(app)/athlete/page.tsx');
  const visitor = code('src/app/(app)/athlete/[id]/page.tsx');

  it('no inline editor and no "add your …" placeholder on the owner\'s page', () => {
    expect(own).not.toMatch(/InlineEdit/);
    expect(own).not.toMatch(/getPlaceholder\('ADD_/);
    expect(own).not.toMatch(/Add your name in Edit Profile/);
    expect(own).not.toMatch(/autoFocus/);
    expect(own).not.toMatch(/\/api\/profile'/); // the page writes no profile field itself
  });

  it('no empty-slot photo buttons — photos are set in Edit Profile → Basic; a SET photo keeps its viewer + Edit door', () => {
    expect(own).not.toMatch(/data-add-avatar|data-add-cover|Add profile picture|Add cover photo/);
    expect(own).toMatch(/<ProfilePhotoViewer[\s\S]*canEdit/);
  });

  it('the owner renders the visitor\'s shapes: bio only when set, achievements only when any, socials through the ONE component', () => {
    expect(own).toMatch(/\{profile\?\.bio && \(/);
    expect(own).toMatch(/\{achievements\.length > 0 && \(/);
    expect(own).not.toMatch(/emptyLabel=/);
    expect(own).toMatch(/<ProfileSocialLinks profile=\{profile\}/);
    expect(visitor).toMatch(/<ProfileSocialLinks profile=\{profile\} \/>/);
    expect(visitor).not.toMatch(/https:\/\/x\.com\//); // the links live in the component alone
    const links = code('src/components/profile/ProfileSocialLinks.tsx');
    for (const k of ['social_twitter', 'social_instagram', 'social_tiktok', 'social_facebook']) expect(links).toContain(k);
    expect(links).toMatch(/if \(!hasSocialLinks\(profile\) \|\| !profile\) return null;/);
  });

  it('no owner-only Sport / Team / Position / Class grid (Position and Team are not even columns)', () => {
    expect(own).not.toMatch(/Position:|>Team:</);
  });

  it('ONE owner control on the header — the pencil; Save and Close both return to the profile', () => {
    expect(own.match(/<ProfileCornerControl mode="owner"/g)?.length).toBe(1);
    const mount = own.slice(own.indexOf('<EditProfileTabs'), own.indexOf('<PostDetailModal'));
    expect(mount).toMatch(/\bcloseOnSave\b/);
    expect(mount).toMatch(/onClose=\{\(\) => \{\s*setIsEditModalOpen\(false\);/);
    const editor = code('src/components/EditProfileTabs.tsx');
    // Save closes THROUGH the dirty check — never a blind onClose after a save.
    expect(editor).toMatch(/onSave\(\);[\s\S]{0,400}if \(closeOnSave\) \{\s*if \(isDirtyOutside\(GROUP_OF_TAB\[tabId\]\)\) requestClose\(\);\s*else onClose\(\);/);
  });

  it('the sports section and the training hero carry no owner nudge; the pins stay', () => {
    const sports = code('src/components/profile/ProfileSports.tsx');
    expect(sports).not.toMatch(/data-sports-empty|onAddSports|No sports yet/);
    expect(sports).toMatch(/if \(cards\.length === 0\) return null;/);
    expect(sports).toMatch(/data-sport-pin=\{card\.sportKey\}/); // Tom, Oct 25 2026: pins stay on the profile
    const hero = code('src/components/training/TrainingHero.tsx');
    expect(hero).not.toMatch(/Add your height|Add your weight/);
    expect(hero).toMatch(/const showBody = Boolean\(heightDisplay \|\| weightDisplay\);/);
  });
});
