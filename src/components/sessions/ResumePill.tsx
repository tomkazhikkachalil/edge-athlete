'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useDrafts } from '@/hooks/useDrafts';
import { useRecording } from '@/components/activities/record/RecordingProvider';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { formatDistance, readUnitPreference } from '@/lib/activities/format';
import { buildDraftsList } from '@/lib/drafts/list';
import { recordingDraftLike } from '@/lib/drafts/recording-like';
import { PILL_KIND_ICON, pickPillSession, pillElapsedS, pillLabel, pillMetric, pillShows } from '@/lib/sessions/pill';
import { getProgressVersion, readProgress, subscribeProgress } from '@/lib/sessions/progress-store';
import { formatElapsed } from '@/lib/workouts/summary';
import type { DraftItem } from '@/lib/drafts/list';

// ── The resume pill (resume pill program, Oct 12 2026) ───────────────────────
// Tom: after starting a workout, a run or a round it was hard to get back
// to it. While something is in progress this pill floats on every signed-in
// page — above the tab bar on a phone, under the header on a large screen —
// with what it is, a live clock and one metric; a tap lands back in it.
// Root-mounted beside the reopen prompt: one source (the viewer's own
// drafts list, private and never cached; the session screen's published
// progress), nothing written, never shown to anyone but the viewer. It is
// not a live event. Hidden on the session's own screen (sessions/paths.ts)
// and wherever the tab bar hides (a screen that owns its bottom edge).
// z-[35]: over the tab bar (30), under the header and the drawer backdrop
// (40) — the drawer dims it; LargerWindow (50) and modals (60) cover it.

export default function ResumePill() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, initialAuthCheckComplete } = useAuth();
  const drafts = useDrafts(!!user);
  // Re-render when a session screen publishes a new number.
  useSyncExternalStore(subscribeProgress, getProgressVersion, () => 0);
  // The recording on THIS device comes from the root engine, merged in first
  // (the Drafts page and the reopen prompt describe it the same way).
  const rec = useRecording();
  const recording = recordingDraftLike(rec.engine?.state ?? null, rec.engine?.lastTouchedAt ?? null, ACTIVITY_TYPE_DEFS);
  const recordingItems = recording ? buildDraftsList({ rounds: [], workouts: [], recording }).inProgress : [];

  const signedIn = initialAuthCheckComplete && !!user;
  const candidates = recordingItems.length > 0 ? [...recordingItems, ...drafts.inProgress].sort(newestFirst) : drafts.inProgress;
  // An unposted finished workout rides the pill when nothing is in progress (Training fixes PR 4).
  const item = signedIn ? pickPillSession(candidates, drafts.drafts) : null;
  if (!item || !pillShows({ pathname, signedIn })) return null;
  const href = item.kind === 'recording' ? '/activities/record' : item.href;
  return <Pill item={item} onOpen={() => router.push(href)} distance={item.kind === 'recording' ? now => rec.engine?.totals(now, null)?.distanceM ?? null : undefined} />;
}

const ts = (iso: string | null): number => {
  const t = iso ? Date.parse(iso) : Number.NaN;
  return Number.isNaN(t) ? 0 : t;
};
const newestFirst = (a: DraftItem, b: DraftItem): number => (ts(b.lastActivityAt) || ts(b.startedAt)) - (ts(a.lastActivityAt) || ts(a.startedAt));

function Pill({ item, onOpen, distance }: { item: DraftItem; onOpen: () => void; distance?: (now: number) => number | null }) {
  const now = useClock(item.clockStartAt !== null && !item.clockPausedAt);
  const elapsedS = pillElapsedS(item.clockStartAt, now, item.clockPausedAt);
  const elapsed = elapsedS === null ? null : formatElapsed(elapsedS);
  const published = readProgress(item.kind, item.id) ?? item.progress;
  const progress = distance ? { ...(published ?? {}), distanceM: distance(now) } : published;
  const metric = pillMetric(item, progress, m => formatDistance(m, readUnitPreference()));
  return (
    <div className="ea-resume-pill pointer-events-none fixed inset-x-0 z-[35] flex justify-center px-4" data-resume-pill-host="">
      <button
        type="button"
        onClick={onOpen}
        aria-label={pillLabel(item, elapsed, metric)}
        data-resume-pill={`${item.kind}:${item.id}`}
        className="ea-interactive pointer-events-auto flex max-w-full min-h-[44px] items-center gap-2.5 rounded-full border border-border bg-surface/95 px-4 py-2 text-sm text-primary shadow-lg backdrop-blur-md"
      >
        <span className="relative inline-flex shrink-0">
          <i className={`fas ${PILL_KIND_ICON[item.kind]} text-base text-brand-fg-strong`} aria-hidden="true"></i>
          <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-600 ea-live-dot" aria-hidden="true" />
        </span>
        <span className="min-w-0 truncate font-semibold" data-resume-pill-title="">{item.title}</span>
        {elapsed && (
          <span className="shrink-0 tabular-nums font-bold" data-resume-pill-elapsed="">{elapsed}</span>
        )}
        {metric && (
          <span className="shrink-0 text-secondary" data-resume-pill-metric="">{metric}</span>
        )}
      </button>
    </div>
  );
}

/**
 * A once-a-second clock in a LEAF (the LiveClock recipe): the tick stores
 * the timestamp, the elapsed time is derived from it, and a hidden tab that
 * comes back re-ticks at once — the number is the clock's, never a count.
 */
function useClock(running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [running]);
  return now;
}
