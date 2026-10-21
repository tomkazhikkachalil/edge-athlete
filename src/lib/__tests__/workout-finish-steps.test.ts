import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearFinishDraft, FINISH_DRAFT_TTL_MS, finishDraftKey, isFinishStep, parseFinishDraft, readFinishDraft, stepFromSearch, writeFinishDraft } from '../workouts/finish-draft';
import { buildDraftsList, pickReopenCandidate, workoutStepHref, type DraftWorkoutRow } from '../drafts/list';
import { reopenActions } from '../drafts/reopen';
import { pickPillSession, pillLabel, pillMetric } from '../sessions/pill';
import type { DraftItem } from '../drafts/list';
import { workoutToSession } from '../workouts/dashboard';
import type { ServerWorkoutSession } from '../workouts/serialize';

// ── Training fixes PR 4 (Oct 21 2026): never lose a finished workout; the steps in the URL ──
// Tom: a finished workout tapped away from before Post was "lost". Finish is
// the RECORD (the workout stands in Training), Post or Done is the DECISION
// (`share_decided_at`); until then it is UNPOSTED — "Finish posting" on the
// pill, the prompt, Drafts, the start screen and its Training card — and
// the flow's steps are history entries: Back and Forward move one step.

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
const T0 = Date.UTC(2026, 9, 21, 9, 0, 0);
const row = (over: Partial<DraftWorkoutRow> = {}): DraftWorkoutRow => ({ id: 'w1', status: 'completed', title: 'Push day', started_at: '2026-10-21T08:00:00Z', last_activity_at: '2026-10-21T08:40:00Z', ended_at: '2026-10-21T08:45:00Z', post_id: null, share_decided_at: null, timed: true, paused_seconds: 0, paused_at: null, sets: [{ reps: 8, weight: 100 }], ...over });
const item = (over: Partial<DraftItem> = {}): DraftItem => ({ kind: 'workout', id: 'w1', postId: null, state: 'draft', title: 'Push day', startedAt: null, clockStartAt: null, lastActivityAt: null, progress: null, href: '/app/workout/w1?step=preview', isCreator: true, scored: true, ...over });

describe('the step in the URL', () => {
  it('reads ?step=summary|preview, the ?share=1 alias is the preview, anything else is the editor', () => {
    expect(stepFromSearch('?step=summary')).toBe('summary');
    expect(stepFromSearch('step=preview')).toBe('preview');
    expect(stepFromSearch('?share=1')).toBe('preview');
    expect(stepFromSearch('?step=editing')).toBe('editing');
    expect(stepFromSearch('?step=bogus')).toBe('editing');
    expect(stepFromSearch('')).toBe('editing');
    expect(stepFromSearch(null)).toBe('editing');
    expect(isFinishStep('preview')).toBe(true);
    expect(isFinishStep('share')).toBe(false);
  });
  it('the page reads the step three ways and never un-mounts the editor on a later change; a step is a router.push', () => {
    const page = read('src/app/(app)/app/workout/[id]/page.tsx');
    expect(page).toMatch(/StepParamReader/);
    expect(page).toMatch(/onRead\(stepFromSearch\(requested\)\)/);
    expect(page).toMatch(/step === null \? null : \(/);
    expect(page).not.toMatch(/initialPhase|wantShare/);
    const editor = read('src/components/workouts/WorkoutEditorScreen.tsx');
    expect(editor).toMatch(/const phase: Phase = finishedSessionId \? step : 'editing';/);
    expect(editor).toMatch(/const effectiveMode: 'live' \| 'manual' \| 'review' = mode === 'live' && finishedSessionId \? 'review' : mode;/);
    expect(editor).toMatch(/router\.push\(next === 'editing' \? `\/app\/workout\/\$\{id\}` : `\/app\/workout\/\$\{id\}\?step=\$\{next\}`\)/);
    expect(editor).toMatch(/router\.push\(`\/app\/workout\/\$\{session\.id\}\?step=summary`\)/);
    expect(editor).toMatch(/router\.replace\(`\/app\/workout\/\$\{data\.session\.id\}\?step=summary`\)/);
    expect(editor).not.toMatch(/setPhase\(/);
    // A decided workout has no steps: an old `?step=` history entry opens the editor, never a second Post.
    expect(editor).toMatch(/if \(step === 'editing' \|\| !session \|\| !\(session\.post_id \|\| session\.share_decided_at\)\) return;\s*router\.replace\(`\/app\/workout\/\$\{session\.id\}`\);/);
    expect(editor).not.toMatch(/beforeunload/);
    // Post and Done leave by replace — Back never re-enters a finished flow.
    expect(editor).toMatch(/clearFinishDraft\(finishedSessionId\);\s*void refreshDrafts\(\);\s*router\.replace\('\/athlete'\);/);
    expect(editor).toMatch(/body: JSON\.stringify\(\{ decided: true \}\)/);
    expect(editor).toMatch(/router\.replace\('\/athlete\?tab=training'\)/);
    // The wake lock and the live rest rule follow the EFFECTIVE mode.
    expect(editor).toMatch(/useWakeLock\(effectiveMode === 'live' && phase === 'editing'\)/);
    // A completed session recomputes BOTH record lists.
    expect(editor).toMatch(/void loadPRs\(initial\.exercises\);\s*void loadExercisePRs\(initial\.exercises, session\.id\);/);
    // The preview is the feed's own card.
    expect(editor).toMatch(/<PostCard post=\{previewPost\} currentUserId=\{currentUserId\} showActions=\{false\} inReview \/>/);
    const flow = read('src/components/workouts/FinishFlow.tsx');
    expect(flow).toMatch(/export function PreviewStep\(/);
    expect(flow).not.toMatch(/export function ShareStep\(/);
    expect(flow).toMatch(/data-finish-edit=""/);
    expect(flow).toMatch(/data-finish-delete=""/);
    expect(flow).toMatch(/data-finish-edit-workout=""/);
    // The start screen leaves history: Back from the editor never lands on it.
    const hook = read('src/hooks/useStartWorkout.ts');
    expect(hook).toMatch(/router\.replace\(`\/app\/workout\/\$\{data\.session\.id\}`\)/);
    expect(hook).toMatch(/router\.replace\(`\/app\/workout\/\$\{data\.activeSessionId\}`\)/);
    expect(hook).not.toMatch(/router\.push\(`\/app\/workout\/\$\{data/);
  });
});

describe('the device draft of the finish flow', () => {
  it('parses what it wrote: the step, the caption, the confirmed PRs, the clips order; another session or an old one is null', () => {
    const raw = JSON.stringify({ v: 1, sessionId: 'w1', savedAt: T0, step: 'preview', caption: 'Solid', checkedPRs: ['bench_1rm', 7], shareOrder: ['/a', '/b'] });
    expect(parseFinishDraft(raw, 'w1', T0 + 1000)).toEqual({ v: 1, sessionId: 'w1', savedAt: T0, step: 'preview', caption: 'Solid', checkedPRs: ['bench_1rm'], shareOrder: ['/a', '/b'] });
    expect(parseFinishDraft(raw, 'w2', T0)).toBeNull();
    expect(parseFinishDraft(raw, 'w1', T0 + FINISH_DRAFT_TTL_MS + 1)).toBeNull();
    expect(parseFinishDraft('{"v":2}', 'w1', T0)).toBeNull();
    expect(parseFinishDraft('garbage', 'w1', T0)).toBeNull();
    expect(parseFinishDraft(JSON.stringify({ v: 1, sessionId: 'w1', savedAt: T0, step: 'share' }), 'w1', T0)?.step).toBe('preview');
    expect(finishDraftKey('w1')).toBe('ea:workout-finish:v1:w1');
  });
  it('is fail-open without a window', () => {
    expect(readFinishDraft('w1')).toBeNull();
    expect(() => writeFinishDraft('w1', { step: 'summary', caption: '', checkedPRs: [], shareOrder: [] })).not.toThrow();
    expect(() => clearFinishDraft('w1')).not.toThrow();
  });
});

describe('an unposted finished workout is surfaced until Post, Done or Delete', () => {
  it('the drafts list: completed, no post, undecided → a draft item whose door is the preview step, with no running clock', () => {
    const list = buildDraftsList({ rounds: [], workouts: [row()], recording: null });
    expect(list.inProgress).toEqual([]);
    expect(list.drafts).toHaveLength(1);
    expect(list.drafts[0]).toMatchObject({ kind: 'workout', id: 'w1', state: 'draft', href: '/app/workout/w1?step=preview', clockStartAt: null, title: 'Push day' });
    expect(workoutStepHref('w1', 'summary')).toBe('/app/workout/w1?step=summary');
    // Decided (Done) or posted: not a draft. Active: in progress as before.
    expect(buildDraftsList({ rounds: [], workouts: [row({ share_decided_at: '2026-10-21T09:00:00Z' })], recording: null }).drafts).toEqual([]);
    expect(buildDraftsList({ rounds: [], workouts: [row({ post_id: 'p1' })], recording: null }).drafts).toEqual([]);
    expect(buildDraftsList({ rounds: [], workouts: [row({ status: 'active' })], recording: null }).inProgress[0]?.state).toBe('in_progress');
  });
  it('the reopen prompt asks about it when nothing is in progress: Finish posting, Delete, never Finish', () => {
    const list = buildDraftsList({ rounds: [], workouts: [row()], recording: null });
    expect(pickReopenCandidate(list)?.id).toBe('w1');
    expect(pickReopenCandidate({ inProgress: [item({ id: 'live', state: 'in_progress' })], drafts: list.drafts })?.id).toBe('live');
    expect(reopenActions(item())).toEqual({ resume: true, finish: false, discard: true, line: 'A finished workout is waiting to be posted.' });
    expect(reopenActions(item({ state: 'in_progress' })).finish).toBe(true);
  });
  it('the pill shows it when nothing is in progress: "Finish posting", no clock, the label says so', () => {
    expect(pickPillSession([], [item()])?.id).toBe('w1');
    expect(pickPillSession([item({ id: 'live', state: 'in_progress' })], [item()])?.id).toBe('live');
    expect(pickPillSession([], [item({ kind: 'round' })])).toBeNull();
    expect(pillMetric(item(), { setsCompleted: 5 })).toBe('Finish posting');
    expect(pillLabel(item(), null, 'Finish posting')).toBe('Finish posting your workout Push day');
    expect(pillLabel(item({ state: 'in_progress' }), '12:00', '5 sets')).toBe('Resume your workout Push day · 12:00 · 5 sets');
  });
  it('the server: Finish never stamps the decision, Done does, a visitor never sees an undecided one; the doors point at the steps', () => {
    const one = read('src/app/api/workouts/[id]/route.ts');
    expect(one.match(/updates\.share_decided_at = new Date\(\)\.toISOString\(\)/g)?.length).toBe(2);
    expect(one).toMatch(/if \(body\.decided !== undefined\) \{\s*if \(body\.decided !== true\) return NextResponse\.json\(\{ error: 'decided must be true' \}, \{ status: 400 \}\);\s*if \(!session\.share_decided_at\) updates\.share_decided_at = new Date\(\)\.toISOString\(\);/);
    expect(one).toMatch(/session\.status !== 'completed' \|\| session\.profile_hidden_at \|\| !session\.share_decided_at/);
    expect(one).not.toMatch(/Finish IS the share decision/);
    const list = read('src/app/api/workouts/route.ts');
    expect(list).toMatch(/\.eq\('status', 'completed'\)\.is\('profile_hidden_at', null\)\.not\('share_decided_at', 'is', null\)/);
    expect(read('src/components/TrainingTab.tsx')).toMatch(/\?step=preview/);
    expect(read('src/components/drafts/ReopenPromptHost.tsx')).toMatch(/\?step=summary/);
    for (const f of ['src/components/TrainingTab.tsx', 'src/components/drafts/ReopenPromptHost.tsx', 'src/lib/drafts/list.ts']) expect(read(f), f).not.toMatch(/share=1/);
    expect(read('src/components/workouts/WorkoutCard.tsx')).toMatch(/data-workout-finish-posting=/);
    expect(read('src/components/workouts/WorkoutStartScreen.tsx')).toMatch(/data-workout-start-unposted=/);
    expect(read('src/components/drafts/DraftRow.tsx')).toMatch(/data-draft-delete-workout=""/);
    expect(read('src/components/sessions/ResumePill.tsx')).toMatch(/pickPillSession\(candidates, drafts\.drafts\)/);
    expect(read('src/components/drafts/ReopenPromptHost.tsx')).toMatch(/drafts: drafts\.drafts \}\)/);
    expect(read('src/components/drafts/ReopenPromptHost.tsx')).toMatch(/\{unposted \? 'Finish posting' : 'Resume'\}/);
    expect(read('src/components/drafts/ReopenPromptHost.tsx')).toMatch(/unposted \? 'Delete' : 'Discard'/);
  });
  it('the Training row says "Finish posting" on an unposted workout only', () => {
    const base = { id: 'w1', profile_id: 'u1', status: 'completed', title: 'Push', started_at: '2026-10-21T08:00:00Z', ended_at: '2026-10-21T08:45:00Z', duration_seconds: 2700, post_id: null, share_decided_at: null, exercises: [] } as unknown as ServerWorkoutSession;
    expect(workoutToSession(base).unposted).toBe(true);
    expect(workoutToSession({ ...base, share_decided_at: '2026-10-21T09:00:00Z' }).unposted).toBeUndefined();
    expect(workoutToSession({ ...base, post_id: 'p1' }).unposted).toBeUndefined();
    expect(read('src/components/TrainingTab.tsx')).toMatch(/session\.unposted && isOwnProfile && \(/);
  });
});
