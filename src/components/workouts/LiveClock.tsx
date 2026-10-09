'use client';

import { useEffect, useState } from 'react';
import { Timer } from 'lucide-react';
import { formatElapsed } from '@/lib/workouts/summary';

/**
 * The live workout's clock (workout capture round PR 3, Oct 9 2026): the
 * elapsed time since `startedAt` and the rest since the last completed set,
 * ticking once a second — HERE, in a leaf, so the tick re-renders this
 * component and nothing else. Until this the tick lived in the editor
 * screen's state and re-rendered the whole exercise tree every second, an
 * open media editor (with its video) included.
 *
 * Derived, never counted: the tick stores the timestamp (reading `Date.now()`
 * during render is impure), and a hidden tab that comes back re-ticks at
 * once, so the time shown is always the clock's, not an interval's count.
 */
export default function LiveClock({ startedAt, lastCompletedMs }: { startedAt: string; lastCompletedMs: number }) {
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
  const elapsedSeconds = Math.max(0, Math.floor((now - Date.parse(startedAt)) / 1000));
  const restSeconds = lastCompletedMs > 0 ? Math.floor((now - lastCompletedMs) / 1000) : null;
  return (
    <>
      <div className="flex items-center gap-1.5 text-brand-fg-strong">
        <Timer className="w-5 h-5" aria-hidden="true" />
        <span className="text-2xl font-bold tabular-nums" data-live-clock="">{formatElapsed(elapsedSeconds)}</span>
      </div>
      {restSeconds !== null && restSeconds < 3600 && (
        <span className="text-xs text-muted whitespace-nowrap">
          Rest {formatElapsed(restSeconds)}
        </span>
      )}
    </>
  );
}
