'use client';

import { useMemo, useState } from 'react';
import { cellText, personKey, tagsForPerson, type DrillFilter, type GameTag, type PlayerLine } from '@/lib/videos/game-derive';
import { periodLabel, sheetEvent, type GameSheet } from '@/lib/videos/game-sheets';
import { formatTimestamp } from '@/lib/videos/rules';
import FaIcon from '@/components/FaIcon';
import { faPlay } from '@/lib/icons/fa/play';
import { faXmark } from '@/lib/icons/fa/xmark';

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const CHIP = 'ea-interactive min-h-[36px] rounded-full border px-3 text-sm font-semibold whitespace-nowrap';

/**
 * One athlete in one game (Sprint 3 PR 6): their line beside their clips,
 * and the clips narrowed — the scoring plays, one period, one kind of play.
 * It is handed only the tags the viewer may already see (the spoiler-free
 * cut is made by the parent), so a drill-down never shows a play the video
 * has not reached. "Play these" walks exactly the clips on screen.
 */
type Narrow = { kind: 'all' } | { kind: 'scoring' } | { kind: 'period'; period: number } | { kind: 'event'; eventKey: string };

const filterOf = (n: Narrow): DrillFilter => (n.kind === 'scoring' ? { scoringOnly: true } : n.kind === 'period' ? { periods: [n.period] } : n.kind === 'event' ? { eventKeys: [n.eventKey] } : {});
const same = (a: Narrow, b: Narrow): boolean => JSON.stringify(a) === JSON.stringify(b);

export default function AthleteClips({ sheet, line, tags, onPlay, onPlayAll, onClose }: { sheet: GameSheet; line: PlayerLine; tags: readonly GameTag[]; onPlay: (tagId: string) => void; onPlayAll: (tagIds: string[]) => void; onClose: () => void }) {
  const [narrow, setNarrow] = useState<Narrow>({ kind: 'all' });
  const mine = useMemo(() => tagsForPerson(sheet, tags, line.key), [sheet, tags, line.key]);
  const shown = useMemo(() => tagsForPerson(sheet, tags, line.key, filterOf(narrow)), [sheet, tags, line.key, narrow]);
  const periods = [...new Set(mine.map(t => t.period).filter((p): p is number => p !== null))].sort((a, b) => a - b);
  const events = [...new Set(mine.map(t => t.eventKey).filter((k): k is string => !!k && !!sheetEvent(sheet, k)))];
  const hasScoring = mine.some(t => !!sheetEvent(sheet, t.eventKey)?.score);
  const chips: Array<{ narrow: Narrow; label: string; key: string }> = [
    { narrow: { kind: 'all' }, label: `All (${mine.length})`, key: 'all' },
    ...(hasScoring ? [{ narrow: { kind: 'scoring' } as Narrow, label: 'Scoring plays', key: 'scoring' }] : []),
    ...(periods.length > 1 ? periods.map(p => ({ narrow: { kind: 'period', period: p } as Narrow, label: periodLabel(sheet, p), key: `period-${p}` })) : []),
    ...(events.length > 1 ? events.map(k => ({ narrow: { kind: 'event', eventKey: k } as Narrow, label: sheetEvent(sheet, k)!.label, key: `event-${k}` })) : []),
  ];
  const cols = sheet.box.filter(c => (typeof c.key === 'string' ? [c.key] : [...c.key]).some(k => (line.stats[k] ?? 0) > 0));

  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3 sm:p-4 space-y-3" data-athlete-clips={line.key} data-athlete-clips-shown={shown.length}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold text-primary break-words" data-athlete-clips-name="">{line.name ?? 'Player'}</p>
          <p className="text-xs text-muted">{mine.length} {mine.length === 1 ? 'clip' : 'clips'} in this game</p>
        </div>
        <button type="button" onClick={onClose} className="ea-icon-btn text-secondary" aria-label="Close"><FaIcon icon={faXmark} /></button>
      </div>

      {cols.length > 0 && (
        <dl className="flex flex-wrap gap-x-4 gap-y-1" data-athlete-clips-line="">
          {cols.map(c => (
            <div key={c.label} className="text-center">
              <dd className="font-mono text-lg font-bold text-primary tabular-nums">{cellText(line.stats, c.key)}</dd>
              <dt className="text-xs text-muted">{c.label}</dt>
            </div>
          ))}
        </dl>
      )}

      {chips.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Narrow the clips">
          {chips.map(c => (
            <button key={c.key} type="button" onClick={() => setNarrow(c.narrow)} aria-pressed={same(narrow, c.narrow)} className={`${CHIP} ${same(narrow, c.narrow) ? 'border-brand bg-brand-soft text-primary' : 'border-border-strong bg-surface text-secondary'}`} data-athlete-clips-filter={c.key}>
              {c.label}
            </button>
          ))}
        </div>
      )}

      {shown.length > 1 && (
        <button type="button" onClick={() => onPlayAll(shown.map(t => t.id))} className={BTN} data-athlete-clips-play-all="">
          <FaIcon icon={faPlay} className="mr-2 text-xs" />Play these {shown.length}
        </button>
      )}

      {shown.length === 0 ? (
        <p className="text-sm text-muted">No clips match.</p>
      ) : (
        <ol className="divide-y divide-border-subtle rounded-lg bg-surface">
          {shown.map(t => {
            const event = sheetEvent(sheet, t.eventKey);
            const role = t.people.find(p => personKey(p) === line.key)?.role;
            const roleLabel = event?.roles.find(r => r.key === role)?.label ?? null;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => onPlay(t.id)} className="ea-interactive flex w-full items-center gap-3 px-2 min-h-[48px] text-left" data-athlete-clip={t.id}>
                  <span className="font-mono text-sm text-brand-fg shrink-0 w-16">{formatTimestamp(t.startMs)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-primary truncate">
                      {event && <span className="mr-2 inline-block rounded bg-surface-muted px-1.5 py-0.5 font-mono text-xs font-semibold text-secondary align-middle">{event.short}</span>}
                      {t.label}
                    </span>
                    <span className="block text-xs text-muted truncate">{[t.period ? periodLabel(sheet, t.period) : null, roleLabel].filter(Boolean).join(' · ')}</span>
                  </span>
                  <FaIcon icon={faPlay} className="text-xs text-muted shrink-0" />
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
