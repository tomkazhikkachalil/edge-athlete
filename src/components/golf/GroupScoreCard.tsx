'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import NumberWheel from '@/components/golf/NumberWheel';
import { useScoreOutbox } from '@/hooks/useScoreOutbox';
import { cardComplete } from '@/lib/golf/score-entry';
import { cellState, overlayOutbox } from '@/lib/golf/score-outbox';
import type { CompleteGolfScorecard } from '@/types/group-posts';

/**
 * The group card (Events program, PR 14): live ENTRY for a playing group
 * — hole-as-ROW × player-as-COLUMN (the viewing grids keep players as
 * rows). A cell is a selection target; the bottom editor strip (the
 * NumberWheel, strokes resting on par, putts on 2, FIR / GIR) commits into
 * the outbox and advances the selected column to its next hole. A
 * partner's column unlocks after "Enter scores for {name}?". Every cell
 * carries a sync dot (saved · pending · conflict · error); a conflict
 * (the per-hole compare-and-set, 209) names both scores and asks keep
 * mine / keep theirs. The footer submits or confirms the player's own
 * card once it is complete.
 */
interface Props {
  scorecard: CompleteGolfScorecard;
  viewerId: string;
  holesPlayed: number;
  startingHole: number;
  onRefresh: () => Promise<void> | void;
  onSubmitCard: (participantId: string) => Promise<boolean>;
}

type Sel = { participantId: string; hole: number } | null;

const DOT: Record<string, string> = { saved: 'bg-emerald-500', pending: 'bg-amber-400', conflict: 'bg-red-500', error: 'bg-red-500' };

export default function GroupScoreCard({ scorecard, viewerId, holesPlayed, startingHole, onRefresh, onSubmitCard }: Props) {
  const event = scorecard.sport_event ?? null;
  const groupProfileIds = useMemo(() => new Set((event?.group?.members ?? []).map(m => m.profile_id)), [event]);
  const columns = useMemo(() => {
    const members = scorecard.participants.filter(p => groupProfileIds.has(p.participant.profile_id) && p.participant.status !== 'declined');
    const order = new Map((event?.group?.members ?? []).map(m => [m.profile_id, m.position]));
    return [...members].sort((a, b) => (order.get(a.participant.profile_id) ?? 99) - (order.get(b.participant.profile_id) ?? 99));
  }, [scorecard.participants, groupProfileIds, event]);
  const holes = useMemo(() => Array.from({ length: holesPlayed }, (_, i) => startingHole + i), [holesPlayed, startingHole]);
  const parOf = (hole: number) => scorecard.golf_data.hole_data?.find(h => h.hole === hole)?.par ?? 4;

  const { entries, commit, resolveConflict, retry } = useScoreOutbox(scorecard.group_post.id, () => { void onRefresh(); });
  const [sel, setSel] = useState<Sel>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [askUnlock, setAskUnlock] = useState<{ participantId: string; name: string; hole: number } | null>(null);
  const [draft, setDraft] = useState<{ strokes: number | null; putts: number | null; fir: boolean | null; gir: boolean | null }>({ strokes: null, putts: null, fir: null, gir: null });
  const [submitting, setSubmitting] = useState(false);
  const [conflictFor, setConflictFor] = useState<{ participantId: string; hole: number } | null>(null);

  const mine = columns.find(c => c.participant.profile_id === viewerId) ?? null;
  const nameOf = (c: (typeof columns)[number]) => `${c.participant.profile?.first_name ?? ''} ${c.participant.profile?.last_name?.[0] ?? ''}`.trim() || 'Player';
  const scoresOf = useCallback((c: (typeof columns)[number]) => overlayOutbox(c.scores.hole_scores ?? [], entries, c.participant.id), [entries]);
  const valueAt = (c: (typeof columns)[number], hole: number) => scoresOf(c).find(h => h.hole_number === hole) ?? null;

  const select = (c: (typeof columns)[number], hole: number) => {
    const isSelf = c.participant.profile_id === viewerId;
    const state = cellState(entries, c.participant.id, hole);
    if (state === 'conflict') { setConflictFor({ participantId: c.participant.id, hole }); return; }
    if (!isSelf && !unlocked.has(c.participant.id)) { setAskUnlock({ participantId: c.participant.id, name: nameOf(c), hole }); return; }
    const existing = valueAt(c, hole);
    setDraft({ strokes: existing?.strokes ?? null, putts: existing?.putts ?? null, fir: existing?.fairway_hit ?? null, gir: existing?.green_in_regulation ?? null });
    setSel({ participantId: c.participant.id, hole });
  };

  const selected = sel ? columns.find(c => c.participant.id === sel.participantId) ?? null : null;
  const saveAndNext = () => {
    if (!sel || !selected) return;
    // The wheel RESTS on par: an untouched wheel saves par — what the button says.
    const strokes = draft.strokes ?? parOf(sel.hole);
    // The hole's version as the card showed it (0 = no score seen) — the
    // per-hole compare-and-set (209); the hook keeps its own saves ahead.
    const serverHole = (selected.scores.hole_scores ?? []).find(h => h.hole_number === sel.hole) as { version?: number } | undefined;
    commit({ participantId: sel.participantId, holeNumber: sel.hole, strokes, putts: draft.putts, fairwayHit: draft.fir, greenInRegulation: draft.gir, expectedVersion: serverHole?.version ?? 0 });
    const idx = holes.indexOf(sel.hole);
    const next = holes[idx + 1];
    if (next) {
      const ex = valueAt(selected, next);
      setDraft({ strokes: ex?.strokes ?? null, putts: ex?.putts ?? null, fir: ex?.fairway_hit ?? null, gir: ex?.green_in_regulation ?? null });
      setSel({ participantId: sel.participantId, hole: next });
    } else {
      setSel(null);
    }
  };

  const myScores = mine ? scoresOf(mine) : [];
  const myComplete = mine ? cardComplete(myScores, holesPlayed, startingHole) : false;
  const myPending = mine ? entries.some(e => e.participantId === mine.participant.id) : false;
  const myStatus = (mine?.scores as { status?: string } | undefined)?.status ?? 'in_progress';
  const enteredByPartner = mine ? mine.scores.entered_by !== null && mine.scores.entered_by !== viewerId && !mine.scores.scores_confirmed : false;
  const sum = (c: (typeof columns)[number], from: number, to: number) => scoresOf(c).filter(h => h.hole_number >= from && h.hole_number <= to && typeof h.strokes === 'number').reduce((s, h) => s + (h.strokes as number), 0) || null;
  const half = holesPlayed === 18 ? 9 : holesPlayed;
  const cols = `48px repeat(${Math.max(columns.length, 1)}, minmax(0, 1fr))`;

  return (
    <div className="flex flex-col h-full" data-group-score-card="">
      {event && (
        <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2">
          <Link href={`/events/${event.id}?tab=leaderboard`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong min-h-[44px]" data-gsc-back="">
            <i className="fas fa-chevron-left text-xs" aria-hidden="true"></i>{event.name}
          </Link>
          <span className="text-xs text-muted">{event.group?.name ?? (event.group ? `Group ${event.group.sequence}` : '')}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        <div className="grid gap-px bg-border rounded-lg overflow-hidden text-sm" style={{ gridTemplateColumns: cols }} role="grid" aria-label="Group scorecard">
          <div className="bg-surface-muted px-2 py-2 text-xs font-semibold text-muted">Hole</div>
          {columns.map(c => (
            <div key={c.participant.id} className="bg-surface-muted px-1 py-2 text-center min-w-0" data-gsc-col={c.participant.profile_id}>
              <span className="block text-xs font-bold text-primary truncate">{nameOf(c)}{c.participant.profile_id === viewerId ? ' (you)' : ''}</span>
            </div>
          ))}
          {holes.map(hole => (
            <HoleRow key={hole} hole={hole} par={parOf(hole)} cols={columns} sel={sel} entries={entries} valueAt={valueAt} onSelect={select} />
          ))}
          {holesPlayed === 18 && <TotalsRow label="Out" cols={columns} value={c => sum(c, startingHole, startingHole + 8)} />}
          {holesPlayed === 18 && <TotalsRow label="In" cols={columns} value={c => sum(c, startingHole + 9, startingHole + 17)} />}
          <TotalsRow label={holesPlayed === 18 ? 'Total' : 'Total'} cols={columns} value={c => sum(c, startingHole, startingHole + half + (holesPlayed === 18 ? 9 : 0) - 1)} bold />
        </div>
        <p className="mt-2 text-[11px] text-muted flex flex-wrap gap-3" aria-hidden="true">
          <span><i className="inline-block w-2 h-2 rounded-full bg-emerald-500 mr-1 align-middle"></i>saved</span>
          <span><i className="inline-block w-2 h-2 rounded-full bg-amber-400 mr-1 align-middle"></i>waiting for signal</span>
          <span><i className="inline-block w-2 h-2 rounded-full bg-red-500 mr-1 align-middle"></i>needs you</span>
        </p>
      </div>

      {sel && selected ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 pt-3 pb-3 safe-bottom" data-gsc-editor={`${selected.participant.profile_id}:${sel.hole}`}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-bold text-primary">Hole {sel.hole} · Par {parOf(sel.hole)} · {nameOf(selected)}</p>
            <button type="button" onClick={() => setSel(null)} className="text-sm text-secondary min-h-[44px] px-2" aria-label="Close the editor">Done</button>
          </div>
          <div className="flex items-stretch gap-3">
            <NumberWheel label="Strokes" min={1} max={15} value={draft.strokes} defaultValue={parOf(sel.hole)} onChange={v => setDraft(d => ({ ...d, strokes: v }))} tone="green" />
            <NumberWheel label="Putts" min={0} max={10} value={draft.putts} defaultValue={2} onChange={v => setDraft(d => ({ ...d, putts: v }))} tone="brand" />
            <div className="flex flex-col gap-2 justify-center">
              <button type="button" aria-pressed={draft.fir === true} onClick={() => setDraft(d => ({ ...d, fir: d.fir === true ? null : true }))} className={`min-h-[44px] px-3 rounded-lg border text-xs font-semibold ${draft.fir ? 'bg-brand text-white border-brand' : 'border-border-strong text-secondary'}`}>FIR</button>
              <button type="button" aria-pressed={draft.gir === true} onClick={() => setDraft(d => ({ ...d, gir: d.gir === true ? null : true }))} className={`min-h-[44px] px-3 rounded-lg border text-xs font-semibold ${draft.gir ? 'bg-brand text-white border-brand' : 'border-border-strong text-secondary'}`}>GIR</button>
            </div>
          </div>
          <button type="button" onClick={saveAndNext} className="mt-3 w-full ea-cta text-white min-h-[48px] rounded-lg text-sm font-semibold" data-gsc-save="">
            Save{draft.strokes === null ? ` ${parOf(sel.hole)}` : ` ${draft.strokes}`} & next
          </button>
        </div>
      ) : mine ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3 safe-bottom flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted">{myStatus === 'submitted' ? 'Your card is submitted.' : myStatus === 'final' ? 'Your card is final.' : myComplete ? (myPending ? 'Saving your last holes…' : 'Your card is complete.') : 'Tap a hole to score.'}</p>
          {myStatus === 'in_progress' && (
            <button
              type="button"
              disabled={!myComplete || myPending || submitting}
              onClick={async () => { setSubmitting(true); await onSubmitCard(mine.participant.id); setSubmitting(false); }}
              className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60"
              data-gsc-submit=""
            >
              {enteredByPartner ? 'Confirm my card' : 'Submit my card'}
            </button>
          )}
        </div>
      ) : null}

      {askUnlock && (
        <ConfirmModal
          isOpen
          title={`Enter scores for ${askUnlock.name}?`}
          message="You'll be scoring their card. They confirm it when they submit."
          confirmText="Enter scores"
          onConfirm={() => { const u = askUnlock; setAskUnlock(null); setUnlocked(prev => new Set(prev).add(u.participantId)); const c = columns.find(x => x.participant.id === u.participantId); if (c) { const ex = valueAt(c, u.hole); setDraft({ strokes: ex?.strokes ?? null, putts: ex?.putts ?? null, fir: ex?.fairway_hit ?? null, gir: ex?.green_in_regulation ?? null }); setSel({ participantId: u.participantId, hole: u.hole }); } }}
          onCancel={() => setAskUnlock(null)}
        />
      )}
      {conflictFor && (
        <ConfirmModal
          isOpen
          title="Someone else scored this hole"
          message={conflictCopy(entries.find(e => e.participantId === conflictFor.participantId && e.holeNumber === conflictFor.hole), conflictFor.hole)}
          confirmText="Keep mine"
          cancelText="Keep theirs"
          onConfirm={() => { const c = conflictFor; setConflictFor(null); void resolveConflict(c.participantId, c.hole, 'mine'); }}
          onCancel={() => { const c = conflictFor; setConflictFor(null); void resolveConflict(c.participantId, c.hole, 'theirs'); }}
        />
      )}
      {entries.some(e => e.state === 'error') && (
        <p role="alert" className="px-4 py-2 text-xs text-red-700 dark:text-red-300">
          A score was refused: {entries.find(e => e.state === 'error')?.error} <button type="button" className="underline min-h-[44px]" onClick={() => { const e = entries.find(x => x.state === 'error'); if (e) retry(e.participantId, e.holeNumber); }}>Retry</button>
        </p>
      )}
    </div>
  );
}

/** "They have 6 on hole 3, you entered 5. Keep yours, or take theirs?" — the 409's current row against the queued value. */
export function conflictCopy(entry: { strokes: number; current?: { strokes: number } | null } | undefined, hole: number): string {
  if (!entry) return 'Keep your score, or take theirs?';
  if (!entry.current) return `Their score on hole ${hole} was removed; you entered ${entry.strokes}. Keep yours, or leave it empty?`;
  return `They have ${entry.current.strokes} on hole ${hole}; you entered ${entry.strokes}. Keep yours, or take theirs?`;
}

type Col = CompleteGolfScorecard['participants'][number];

function HoleRow({ hole, par, cols, sel, entries, valueAt, onSelect }: { hole: number; par: number; cols: Col[]; sel: Sel; entries: ReturnType<typeof useScoreOutbox>['entries']; valueAt: (c: Col, hole: number) => { strokes: number | null } | null; onSelect: (c: Col, hole: number) => void }) {
  return (
    <>
      <div className="bg-surface px-2 py-1 min-h-[44px] flex flex-col justify-center">
        <span className="text-sm font-bold text-primary leading-none">{hole}</span>
        <span className="text-[10px] text-muted leading-none mt-1">par {par}</span>
      </div>
      {cols.map(c => {
        const v = valueAt(c, hole);
        const state = cellState(entries, c.participant.id, hole);
        const active = sel?.participantId === c.participant.id && sel.hole === hole;
        const diff = typeof v?.strokes === 'number' ? v.strokes - par : null;
        return (
          <button
            key={c.participant.id}
            type="button"
            role="gridcell"
            onClick={() => onSelect(c, hole)}
            aria-label={`Hole ${hole}, ${c.participant.profile?.first_name ?? 'player'}${typeof v?.strokes === 'number' ? `, ${v.strokes}` : ', not scored'}`}
            className={`relative bg-surface min-h-[44px] flex items-center justify-center text-base font-semibold ${active ? 'ring-2 ring-inset ring-brand' : ''} ${diff !== null && diff < 0 ? 'text-red-600 dark:text-red-400' : diff !== null && diff > 0 ? 'text-primary' : 'text-primary'}`}
            data-gsc-cell={`${c.participant.profile_id}:${hole}`}
            data-gsc-state={state}
          >
            {typeof v?.strokes === 'number' ? v.strokes : <span className="text-faint">·</span>}
            {typeof v?.strokes === 'number' && <span className={`absolute right-1 top-1 w-1.5 h-1.5 rounded-full ${DOT[state]}`} aria-hidden="true" />}
          </button>
        );
      })}
    </>
  );
}

function TotalsRow({ label, cols, value, bold = false }: { label: string; cols: Col[]; value: (c: Col) => number | null; bold?: boolean }) {
  return (
    <>
      <div className={`bg-surface-muted px-2 py-2 text-xs ${bold ? 'font-bold text-primary' : 'font-semibold text-muted'}`}>{label}</div>
      {cols.map(c => <div key={c.participant.id} className={`bg-surface-muted py-2 text-center text-sm ${bold ? 'font-bold text-primary' : 'text-secondary'}`}>{value(c) ?? '—'}</div>)}
    </>
  );
}
