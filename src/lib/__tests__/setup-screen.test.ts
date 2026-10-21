import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Program E1b (Oct 2026): the set-up card, the Details sheet, the live area
// from the layout table, the Finish seeded from the recording. Read from the
// source — the screens render in a browser.
const ROOT = process.cwd();
const code = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('set up before Start — the screen', () => {
  const screen = code('src/components/activities/record/RecordActivityScreen.tsx');
  const card = code('src/components/activities/record/SetupCard.tsx');
  const sheet = code('src/components/activities/record/DetailsSheet.tsx');
  const finish = code('src/components/activities/record/FinishSheet.tsx');

  it('the idle branch is the SetupCard (data-record-ready kept), Start stays in the fixed controls bar and arms the bell', () => {
    expect(screen).toMatch(/\{state\.status === 'idle' && layout && \(\s*<SetupCard/);
    expect(card).toMatch(/data-record-ready=""/);
    expect(card).not.toMatch(/data-record-start/);
    expect(code('src/components/activities/record/RecorderControls.tsx')).toMatch(/data-record-start=""/);
    expect(screen).toMatch(/if \(state\.timerArmed\) armBell\(\);\s*dispatch\(\{ type: 'start', now: Date\.now\(\) \}\);/);
  });
  it('the card asks the layout\'s questions through the one form (no effort, no notes), keeps the map toggle hook, arms a timer, offers the indoor twin', () => {
    expect(card).toMatch(/<FinishDetailsForm[\s\S]*only=\{layout\.setupFields\}[\s\S]*showEffort=\{false\}[\s\S]*showNotes=\{false\}/);
    expect(card).toMatch(/onChange=\{v => dispatch\(\{ type: 'setAnswers', answers: v \}\)\}/);
    expect(card).toMatch(/data-record-map-toggle=""[\s\S]*dispatch\(\{ type: 'setMap', on: e\.target\.checked \}\)/);
    expect(card).toMatch(/<TimerSetup[\s\S]*arm[\s\S]*dispatch\(\{ type: 'timerSet', spec \}\)/);
    expect(card).toMatch(/data-record-indoor-twin=\{twin\}/);
    expect(card).toMatch(/data-record-choose-another=""/);
    // F1: the family's timer is preselected ONCE per recording (undefined = undecided; null = removed, stays removed).
    expect(card).toMatch(/const timerDefault = layout\.timerDefault;/);
    expect(card).toMatch(/const undecided = state\.timerArmed === undefined;/);
    expect(card).toMatch(/dispatch\(\{ type: 'timerSet', spec: TIMER_PRESETS\[timerDefault\]\[0\]\.spec \}\)/);
  });
  it('the live area is the layout\'s order; the Details row opens the sheet, which writes the same answers (debounced) and never asks a climb\'s scale', () => {
    expect(screen).toMatch(/layout\.live\.map\(\(panel: LivePanel\) => \{/);
    for (const p of ["case 'map':", "case 'stats':", "case 'climbs':", "case 'timer':", "case 'details':", "case 'photos':", "case 'segments':"]) expect(screen).toContain(p);
    expect(screen).toMatch(/data-record-details-open=""/);
    expect(screen).toMatch(/<DetailsSheet[^>]*onChange=\{a => dispatch\(\{ type: 'setAnswers', answers: a \}\)\}/);
    expect(sheet).toMatch(/omit=\{type === 'climb' \? \['scale'\] : undefined\}/);
    expect(sheet).toMatch(/const DEBOUNCE_MS = 300;/);
    expect(sheet).toMatch(/data-record-details-sheet=""/);
  });
  it('the last session\'s choices land in the RECORDING once (prefill), not in the Finish; the Finish is seeded from recordingAnswers', () => {
    expect(screen).toMatch(/const prefillFor = state && !state\.prefilled \? state\.id : null;/);
    expect(screen).toMatch(/engine\.dispatch\(\{ type: 'prefill', details: j\.details \?\? \{\} \}\)/);
    expect(screen).toMatch(/initial=\{recordingAnswers\(state\)\}/);
    expect(screen).not.toMatch(/prefill=\{|initialDetails=/);
    expect(finish).toMatch(/initial: FinishFormValue;/);
    expect(finish).not.toMatch(/prefill: Details \| null|initialDetails\?:/);
    expect(screen).toMatch(/data-record-setup-line=""/);
  });
  it('F2 — a calm session: the answers line under the clock, no stat grid, no Mark', () => {
    expect(screen).toMatch(/line=\{layout\.calm \? setupLine : null\}/);
    expect(screen).toMatch(/mark=\{layout\?\.mark !== false\}/);
    expect(code('src/components/activities/record/LiveStats.tsx')).toMatch(/data-record-calm-line=""/);
    expect(code('src/components/activities/record/RecorderControls.tsx')).toMatch(/\{mark && \(/);
  });
  it('F3 — climb: the set-up card offers the grade scale (narrowed by the style) and the Finish sums the climbs', () => {
    expect(card).toMatch(/layout\.setup\.includes\('climbScale'\)/);
    expect(card).toMatch(/SCALES_FOR_STYLE\[style\] : CLIMB_SCALES/);
    expect(card).toMatch(/dispatch\(\{ type: 'climbScale', scale: s \}\)/);
    expect(finish).toMatch(/data-record-review-climbs=""/);
  });
  it('F5 — swim: the lengths counter writes the reducer\'s count; the Finish prefills the distance from it', () => {
    expect(screen).toMatch(/<LengthsCounter[^>]*onChange=\{n => dispatch\(\{ type: 'lengthsSet', lengths: n \}\)\}/);
    expect(screen).toMatch(/lengths: state\.type === 'swim' \? state\.lengths \?\? 0 : 0,/);
    expect(finish).toMatch(/data-record-review-lengths=\{summary\.lengths\}/);
    const counter = code('src/components/activities/record/LengthsCounter.tsx');
    expect(counter).toMatch(/data-record-length-add=""/);
    expect(counter).toMatch(/min-h-\[56px\]/);
    expect(counter).not.toMatch(/purgeExpired|openRecordingStore|useWatchPosition|useWakeLock|useDirtyClose/);
  });
  it('the new screens obey the recorder\'s import ban', () => {
    for (const src of [card, sheet]) expect(src).not.toMatch(/purgeExpired|openRecordingStore|useWatchPosition|useWakeLock|useDirtyClose/);
  });
});
