import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newRecording, reduce, reviewOf } from '../activities/record/recording';
import { composeActivityPostStats } from '../activities/post-card';
import { previewActivityPostStats, PREVIEW_ACTIVITY_ID } from '../activities/record/preview';

// Training fixes PR 6 (Oct 21 2026): the activity's finish is two steps — the
// questionnaire, then preview and post — whose state lives on the recording
// and whose step the URL mirrors; the preview is the feed's own card over the
// ONE composition the server uses once the row exists.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const t0 = 1_700_000_000_000;

describe('the review on the recording', () => {
  it('a recording stored before reads as the questionnaire; setReview is finished-only and shape-checked', () => {
    let s = newRecording('r1', 'p', 'yoga');
    expect(reviewOf(s)).toEqual({ step: 'details', caption: '', onFeed: true, shareAs: 'training' });
    expect(reviewOf(s, false).onFeed).toBe(false);
    expect(reduce(s, { type: 'setReview', review: { step: 'preview' } }).review).toBeUndefined();
    s = reduce(reduce(s, { type: 'start', now: t0 }), { type: 'finish', now: t0 + 60_000 });
    s = reduce(s, { type: 'setReview', review: { step: 'preview', caption: 'x'.repeat(3000), onFeed: false, shareAs: 'sport' } });
    expect(s.review).toEqual({ step: 'preview', caption: 'x'.repeat(2000), onFeed: false, shareAs: 'sport' });
    s = reduce(s, { type: 'setReview', review: { step: 'bogus' as never, shareAs: 'nope' as never } });
    expect(s.review).toMatchObject({ step: 'preview', shareAs: 'sport', caption: 'x'.repeat(2000) });
    s = reduce(s, { type: 'setReview', review: { step: 'details' } });
    expect(reviewOf(s).step).toBe('details');
  });
});

describe('the preview is the server\'s composition over the recording', () => {
  it('composes the card\'s snapshot; omits what is absent', () => {
    const base = { activityId: 'a1', type: 'run' as const, name: 'Hill repeats', occurredOn: '2026-10-21', distanceM: 5000, movingS: 1500, elapsedS: 1600, elevGainM: 40, elevLossM: 38, avgHr: null, routePreview: 'abc', credit: null, segments: [], steps: null, photoCount: 0, effort: null, details: {}, derived: {} };
    const s = composeActivityPostStats(base);
    expect(s).toMatchObject({ type: 'activity', activity_id: 'a1', activity_type: 'run', name: 'Hill repeats', distance_m: 5000, moving_s: 1500, elapsed_s: 1600, elev_gain_m: 40, elev_loss_m: 38, route_preview: 'abc', credit: null });
    for (const k of ['segments', 'steps', 'photo_count', 'effort', 'details', 'max_speed_mps', 'runs']) expect(s).not.toHaveProperty(k);
    const full = composeActivityPostStats({ ...base, segments: [{ kind: 'interval', label: null, distance_m: 0, seconds: 30 }], steps: 6000, photoCount: 2, effort: 7, details: { surface: 'trail' }, derived: { max_speed_mps: 4.2, runs: 3 } });
    expect(full).toMatchObject({ segments: [{ kind: 'interval', seconds: 30 }], steps: 6000, photo_count: 2, effort: 7, details: { surface: 'trail' }, max_speed_mps: 4.2, runs: 3 });
  });
  it('the recorder\'s preview: the totals, the route (none when supervised), the segments as counts, the photos, the answers; a typed distance wins', () => {
    let s = newRecording('r2', 'p', 'run');
    s = reduce(s, { type: 'start', now: t0 });
    s = reduce(s, { type: 'markStart', now: t0 + 10_000 });
    s = reduce(s, { type: 'markEnd', now: t0 + 40_000, kind: 'interval', id: 'seg-1' });
    s = reduce(s, { type: 'photoAdded', localId: 'ph1', mediaType: 'image', now: t0 + 50_000 });
    s = reduce(s, { type: 'finish', now: t0 + 120_000 });
    const totals = { elapsedS: 120, distanceM: 400.4, movingS: 110, elevGainM: 3, elevLossM: 2, currentPaceSPerM: null, avgPaceSPerM: null, currentSpeedMps: null, steps: 500, lastFixAgeS: null, gpsSettling: false };
    const route: Array<[number, number]> = [[45.4, -75.7], [45.41, -75.71]];
    const p = previewActivityPostStats({ state: s, totals, route, supervised: false, name: 'Morning run', manualDistanceM: null, effort: 6, details: { surface: 'road' }, occurredOn: '2026-10-21' });
    expect(p).toMatchObject({ activity_id: PREVIEW_ACTIVITY_ID, activity_type: 'run', name: 'Morning run', distance_m: 400, moving_s: 110, elapsed_s: 120, elev_gain_m: 3, elev_loss_m: 2, steps: 500, photo_count: 1, effort: 6, details: { surface: 'road' }, credit: 'Recorded live in Edge Athlete' });
    expect(typeof p.route_preview).toBe('string');
    expect(p.segments).toHaveLength(1);
    expect(p.segments![0]).toMatchObject({ kind: 'interval', seconds: 30, distance_m: 0 });
    expect(p).not.toHaveProperty('max_speed_mps');
    expect(previewActivityPostStats({ state: s, totals, route, supervised: true, name: 'x', manualDistanceM: 1500, effort: null, details: {}, occurredOn: '2026-10-21' })).toMatchObject({ route_preview: null, distance_m: 1500 });
    expect(previewActivityPostStats({ state: s, totals: null, route: [], supervised: false, name: 'x', manualDistanceM: null, effort: null, details: {}, occurredOn: '2026-10-21' })).toMatchObject({ elapsed_s: 120, distance_m: null, route_preview: null });
  });
  it('the server composes through the same function', () => {
    const server = read('src/lib/activities/share-server.ts');
    expect(server).toMatch(/statsData: composeActivityPostStats\(\{/);
    expect(server).not.toMatch(/type: 'activity',\s*activity_id: activityId,/);
  });
});

describe('the sheet and the screen', () => {
  const sheet = read('src/components/activities/record/FinishSheet.tsx');
  const screen = read('src/components/activities/record/RecordActivityScreen.tsx');
  it('two steps: the questionnaire with Delete and Continue, then preview and post with Edit, Delete and Post / Save; the answers, the name and the distance reach the recording as typed', () => {
    expect(sheet).toMatch(/data-record-step=\{step\}/);
    expect(sheet).toMatch(/data-record-continue=""/);
    expect(sheet).toMatch(/data-record-edit=""/);
    expect(sheet.match(/data-record-discard=""/g)?.length).toBe(2);
    expect(sheet).toMatch(/data-record-preview-card=""/);
    expect(sheet).toMatch(/data-record-preview-off=""/);
    expect(sheet).toMatch(/data-record-save=""/);
    expect(sheet).toMatch(/onChange=\{v => onReview\(\{ onFeed: v \}\)\}/);
    expect(sheet).toMatch(/onChange=\{e => onReview\(\{ caption: e\.target\.value\.slice\(0, 2000\) \}\)\}/);
    expect(sheet).toMatch(/setAnswers\(v\);\s*onAnswers\(v\);/);
    expect(sheet).toMatch(/setName\(v\); onName\(v\);/);
    expect(sheet).toMatch(/onDistance\(parsedDistance\(\)\);\s*onStep\('preview'\);/);
    expect(sheet).not.toMatch(/readFeedDefault|useState\(''\)/);
  });
  it('the screen mirrors the step in the URL (pushState / replaceState / popstate), composes the preview from the recording, and Delete names the activity', () => {
    expect(screen).toMatch(/dispatch\(\{ type: 'setReview', review: \{ step: next \} \}\);\s*try \{ window\.history\.pushState\(null, '', `\?step=\$\{next\}`\); \}/);
    expect(screen).toMatch(/window\.history\.replaceState\(null, '', `\?step=\$\{review\.step\}`\)/);
    expect(screen).toMatch(/window\.addEventListener\('popstate', onPop\)/);
    expect(screen).toMatch(/<ActivityPostCard\s*statsData=\{previewActivityPostStats\(\{/);
    expect(screen).toMatch(/onAnswers=\{a => dispatch\(\{ type: 'setAnswers', answers: a \}\)\}/);
    expect(screen).toMatch(/onName=\{name => dispatch\(\{ type: 'setName'/);
    expect(screen).toMatch(/onDistance=\{m => dispatch\(\{ type: 'setManualDistance', distanceM: m \}\)\}/);
    expect(screen).toMatch(/title=\{finished \? 'Delete this activity\?' : 'Discard this recording\?'\}/);
    // The sheet obeys the recorder's import ban.
    expect(sheet).not.toMatch(/purgeExpired|openRecordingStore|useWatchPosition|useWakeLock|useDirtyClose/);
  });
});
