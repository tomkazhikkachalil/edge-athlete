'use client';

import { useState } from 'react';
import { scoreLabel, type GameScore } from '@/lib/sport-events/game';
import { scorePath } from '@/lib/sport-events/stat-flush';

interface Props {
  eventId: string;
  roundId: string;
  score: GameScore & { version: number };
  sides: [string, string];
  /** The viewer keeps the score (a recorder or an organizer on a live game). */
  canScore: boolean;
  onSaved: () => void;
}

const CHIP = 'ea-interactive border border-border-strong text-primary min-w-[44px] min-h-[44px] rounded-lg text-lg font-bold inline-flex items-center justify-center disabled:opacity-40';

/**
 * The game's score (Events program, phase 4): the two sides and the
 * period as −/+ chips; every tap is ONE compare-and-set write on the
 * round's `score_version` — a 409 adopts the server's score and says so
 * (never a forced overwrite). Read-only (the label) for everyone else.
 */
export default function ScoreControl({ eventId, roundId, score, sides, canScore, onSaved }: Props) {
  // The poll's score, unless this control's own write is newer (no setState in an effect: derived).
  const [override, setOverride] = useState<(GameScore & { version: number }) | null>(null);
  const local = override && override.version >= score.version ? override : score;
  const setLocal = setOverride;
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const write = async (next: { side1_score: number; side2_score: number; period: number }) => {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(scorePath(eventId, roundId), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...next, expected_version: local.version }) });
      const body = (await res.json().catch(() => ({}))) as { score?: { version: number }; current?: (GameScore & { version: number }) | null; error?: string };
      if (res.ok && body.score) {
        setLocal({ ...next, version: body.score.version });
        onSaved();
      } else if (res.status === 409 && body.current) {
        setLocal(body.current);
        setNote('The score changed under you — showing the latest.');
      } else {
        setNote(body.error ?? 'Could not save the score.');
      }
    } catch {
      setNote('Offline — try again.');
    } finally {
      setBusy(false);
    }
  };
  const s1 = local.side1_score ?? 0;
  const s2 = local.side2_score ?? 0;
  const period = local.period ?? 1;

  if (!canScore) return <p className="text-xl font-bold text-primary" data-event-score-line="">{scoreLabel(local, sides)}</p>;
  return (
    <div className="space-y-2" data-score-control="">
      <p className="text-xl font-bold text-primary" data-event-score-line="">{scoreLabel(local, sides)}</p>
      <div className="grid grid-cols-2 gap-3">
        {([1, 2] as const).map(side => {
          const v = side === 1 ? s1 : s2;
          const set = (n: number) => write({ side1_score: side === 1 ? n : s1, side2_score: side === 2 ? n : s2, period });
          return (
            <div key={side} className="flex items-center justify-between gap-2 bg-surface-muted rounded-lg px-3 py-2">
              <span className="text-sm font-semibold text-primary truncate">{sides[side - 1]}</span>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => set(v - 1)} disabled={busy || v <= 0} className={CHIP} aria-label={`${sides[side - 1]} minus one`} data-score-minus={side}>−</button>
                <span className="min-w-[32px] text-center text-lg font-bold tabular-nums text-primary">{v}</span>
                <button type="button" onClick={() => set(v + 1)} disabled={busy || v >= 999} className={CHIP} aria-label={`${sides[side - 1]} plus one`} data-score-plus={side}>+</button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2 text-sm text-secondary">
        <span>Period</span>
        <button type="button" onClick={() => write({ side1_score: s1, side2_score: s2, period: period - 1 })} disabled={busy || period <= 1} className={CHIP} aria-label="Period minus one" data-period-minus="">−</button>
        <span className="min-w-[24px] text-center font-bold text-primary" data-score-period="">{period}</span>
        <button type="button" onClick={() => write({ side1_score: s1, side2_score: s2, period: period + 1 })} disabled={busy || period >= 99} className={CHIP} aria-label="Period plus one" data-period-plus="">+</button>
      </div>
      {note && <p role="status" className="text-xs text-amber-800 dark:text-amber-200" data-score-note="">{note}</p>}
    </div>
  );
}
