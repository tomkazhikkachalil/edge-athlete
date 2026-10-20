import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Program D (Convention 51, Oct 2026): ONE Sports tab; a sport's setup is
// short steps; the sports choice saves from the Sports tab; the old
// one-page form is gone. Read from the source.
const ROOT = process.cwd();
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('Edit Profile: one Sports tab, the setup as steps', () => {
  const editor = code('src/components/EditProfileTabs.tsx');
  it('five fixed tabs — never a tab per registered sport', () => {
    expect(editor).toMatch(/type TabId = 'basic' \| 'sports' \| 'body_metrics' \| 'socials' \| 'recruiting';/);
    expect(editor).toMatch(/\{ id: 'sports', label: 'Sports'/);
    expect(editor).not.toMatch(/allSports\.forEach|SPORT_TAB_IDS|isSportTab/);
  });
  it('the picker lives on the Sports tab and the sports choice saves from there — Save Basic never sends `sport`', () => {
    expect(editor).toMatch(/const renderSportsTab = \(\) => \([\s\S]*<SportMultiSelect /);
    expect(editor).toMatch(/case 'sports': \{[\s\S]*updateData = \{ sport: selectedSports\[0\]/);
    expect(editor).toMatch(/if \(tabId === 'sports' && !actingAs && !sportRemovalOkRef\.current\) \{/);
    expect(editor).toMatch(/void saveTab\('sports'\);/);
    const basic = editor.slice(editor.indexOf("case 'basic':"), editor.indexOf("case 'sports': {"));
    expect(basic).not.toMatch(/sport:/);
    expect(basic).not.toMatch(/\/api\/sport-settings/);
  });
  it('a guardian acting for an athlete never sees the Sports tab', () => {
    expect(editor).toMatch(/actingAs \? t\.id !== 'sports' : true/);
  });
  it('the flow is mounted from the row and saves through the ONE path: validate → merge → PUT, then the snapshot', () => {
    expect(editor).toMatch(/<SportSetupFlow[\s\S]*onSave=\{values => saveSportSetup\(setupSport, values\)\}/);
    expect(editor).toMatch(/const saveSportSetup = async [\s\S]*validateSettingsValues\(schema, values\)[\s\S]*mergeSettingsForSave\(schema, storedSportSettingsRef\.current\[sportKey\], values\)[\s\S]*snapRef\.current\[sportSnapKey\(sportKey\)\] = JSON\.stringify\(values\);/);
    expect(editor).toMatch(/data-sport-setup-open=\{sportKey\}/);
    expect(editor).toMatch(/data-sport-row-line=""/);
  });
  it('the one-page form is deleted; the flow and nothing else renders the field through SportSettingsField', () => {
    expect(fs.existsSync(path.join(ROOT, 'src/components/SportSettingsForm.tsx'))).toBe(false);
    const flow = code('src/components/SportSetupFlow.tsx');
    expect(flow).toMatch(/<StepFlow /);
    expect(flow).toMatch(/<SportSettingsField /);
    expect(flow).toMatch(/stepsForSchema\(schema, sportName\)/);
    expect(flow).toMatch(/data-sport-setup=\{sportKey\}/);
    expect(flow).toMatch(/data-sport-setup-review=""/);
    expect(flow).toMatch(/overlayZClass="z-\[80\]"/);
    expect(flow).not.toMatch(/fetch\(/);
  });
  it('the doors land on the Sports tab', () => {
    const page = code('src/app/(app)/athlete/page.tsx');
    expect(page).toMatch(/setEditInitialTab\('sports'\);\s*setIsEditModalOpen\(true\);/);
    expect(page).toMatch(/onAddSports=\{\(\) => \{ setEditInitialTab\('sports'\); setIsEditModalOpen\(true\); \}\}/);
  });
});
