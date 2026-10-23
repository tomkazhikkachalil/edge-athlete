'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { formatElapsed } from '@/lib/workouts/summary';
import { workoutElapsedS } from '@/lib/workouts/timing';

/**
 * The live workout's clock (workout capture round PR 3, Oct 9 2026): the
 * elapsed time since `startedAt`, ticking once a second — HERE, in a leaf,
 * so the tick re-renders this component and nothing else. Until this the
 * tick lived in the editor screen's state and re-rendered the whole exercise
 * tree every second, an open media editor (with its video) included.
 *
 * Derived, never counted: the tick stores the timestamp (reading `Date.now()`
 * during render is impure), and a hidden tab that comes back re-ticks at
 * once, so the time shown is always the clock's, not an interval's count.
 * Workout screen PR 2 (260): pauses are excluded and the clock STANDS while
 * paused (`pausedAt`) — the recorder's elapsedS rule (timing.ts).
 *
 * Rest timer round (Oct 22 2026): the clock no longer draws a rest of its
 * own. It used to show "Rest m:ss" = the seconds since the LAST COMPLETED
 * SET — a counter unrelated to the bar's Rest timer that appeared whenever
 * any set was marked complete (the stopwatch's Save to set included) and
 * read, to Tom, as "a rest counter next to the workout clock, seemingly at
 * random". The bar's Rest timer is the one rest; the editor shows the
 * workout's TOTAL rest beside this clock (`data-workout-rest-total`).
 */
export default function LiveClock({ startedAt, pausedSeconds = 0, pausedAt = null }: { startedAt: string; pausedSeconds?: number | null; pausedAt?: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const interval = setInterval(tick, 1000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  const elapsedSeconds = workoutElapsedS({ started_at: startedAt, paused_seconds: pausedSeconds, paused_at: pausedAt }, now);
  return (
    <div className={`flex items-center gap-1.5 ${pausedAt ? 'text-muted' : 'text-brand-fg-strong'}`} data-live-clock-state={pausedAt ? 'paused' : 'running'}>
      <Timer className="w-5 h-5" aria-hidden="true" />
      <span className="text-2xl font-bold tabular-nums" data-live-clock="">{formatElapsed(elapsedSeconds)}</span>
    </div>
  );
}
