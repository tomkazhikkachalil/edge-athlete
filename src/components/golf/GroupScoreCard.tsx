'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import NumberWheel from '@/components/golf/NumberWheel';
import { useScoreOutbox } from '@/hooks/useScoreOutbox';
import { cardComplete } from '@/lib/golf/score-entry';
import { cellState, overlayOutbox } from '@/lib/golf/score-outbox';
import { eventApi } from '@/lib/sport-events/client';
import { matchColumns } from '@/lib/sport-events/match-view';
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
 *
 * Phase 3 — a MATCH round: the columns are the counting cards only
 * (foursomes → the captains, headed "A & B"), the MatchStrip above the
 * grid carries the engine's status line, "Concede hole n" for the viewer's
 * side on the selected hole and "Concede the match", and the extra-hole
 * editor when the match is all square after the last (a NumberWheel per
 * counting player, saved through the match route with its `version` —
 * never the outbox: extra holes cannot enter golf_hole_scores). The footer
 * never offers "Submit my card" on a match round: a conceded hole leaves
 * the card short, and card status is irrelevant to a match.
 */
interface Props {
  scorecard: CompleteGolfScorecard;
  viewerId: string;
  holesPlayed: number;
  startingHole: number;
  onRefresh: () => Promise<void> | void;
  onSubmitCard: (participantId: string) => Promise<boolean>;
  /** Phase 4: the group the card shows — a recorder / organizer switches between the round's groups; default the viewer's own. */
  group?: NonNullable<CompleteGolfScorecard['sport_event']>['group'];
  /** Phase 4: the viewer records for everyone (a named recorder or an organizer) — no partner confirm, no own card needed. */
  recorder?: boolean;
}

type Sel = { participantId: string; hole: number } | null;

const DOT: Record<string, string> = { saved: 'bg-emerald-500', pending: 'bg-amber-400', conflict: 'bg-red-500', error: 'bg-red-500' };

export default function GroupScoreCard({ scorecard, viewerId, holesPlayed, startingHole, onRefresh, onSubmitCard, group: groupProp, recorder = false }: Props) {
  const event = scorecard.sport_event ?? null;
  const group = groupProp ?? event?.group ?? null;
  const match = event?.match ?? null;
  // On a match round the columns are the COUNTING cards (foursomes: the captains), side 1 first.
  const orderedMembers = useMemo(() => {
    const members = group?.members ?? [];
    return match ? matchColumns(members, match.sides.flatMap(s => s.card_participant_ids)) : [...members].sort((a, b) => a.position - b.position);
  }, [group, match]);
  const groupProfileIds = useMemo(() => new Set(orderedMembers.map(m => m.profile_id)), [orderedMembers]);
  const columns = useMemo(() => {
    const members = scorecard.participants.filter(p => groupProfileIds.has(p.participant.profile_id) && p.participant.status !== 'declined');
    const order = new Map(orderedMembers.map((m, i) => [m.profile_id, i]));
    return [...members].sort((a, b) => (order.get(a.participant.profile_id) ?? 99) - (order.get(b.participant.profile_id) ?? 99));
  }, [scorecard.participants, groupProfileIds, orderedMembers]);
  const holes = useMemo(() => Array.from({ length: holesPlayed }, (_, i) => startingHole + i), [holesPlayed, startingHole]);
  const parOf = (hole: number) => scorecard.golf_data.hole_data?.find(h => h.hole === hole)?.par ?? 4;

  const { entries, commit, resolveConflict, retry } = useScoreOutbox(scorecard.group_post.id, () => { void onRefresh(); });
  const [sel, setSel] = useState<Sel>(null);
  const [unlocked, setUnlocked] = useState<Set<string>>(new Set());
  const [askUnlock, setAskUnlock] = useState<{ participantId: string; name: string; hole: number } | null>(null);
  const [draft, setDraft] = useState<{ strokes: number | null; putts: number | null; fir: boolean | null; gir: boolean | null }>({ strokes: null, putts: null, fir: null, gir: null });
  const [submitting, setSubmitting] = useState(false);
  const [conflictFor, setConflictFor] = useState<{ participantId: string; hole: number } | null>(null);
  const [matchBusy, setMatchBusy] = useState(false);
  const [matchError, setMatchError] = useState<string | null>(null);
  const [askConcedeMatch, setAskConcedeMatch] = useState(false);
  const [extra, setExtra] = useState<Record<string, number | null>>({});

  const mine = columns.find(c => c.participant.profile_id === viewerId) ?? null;
  const nameOf = (c: (typeof columns)[number]) => `${c.participant.profile?.first_name ?? ''} ${c.participant.profile?.last_name?.[0] ?? ''}`.trim() || 'Player';
  // Foursomes: the column is the SIDE's card ("Ann & Al"), never the captain alone.
  const headerOf = (c: (typeof columns)[number]) => {
    if (!match || match.config.sides !== 'foursomes') return nameOf(c);
    const side = match.sides.find(s => s.members.some(m => m.profile_id === c.participant.profile_id));
    return side ? side.members.map(m => m.name).join(' & ') : nameOf(c);
  };
  const conceded = useMemo(() => new Set((match?.concessions ?? []).map(c => c.hole).filter((h): h is number => h !== null)), [match]);
  const matchLive = !!match && match.state.status !== 'completed' && event?.status === 'live';
  const mySide = match?.side_of_viewer ?? null;
  const matchApi = event ? eventApi(event.id, null) : null;
  const concede = async (hole: number | null) => {
    if (!match || !matchApi || mySide === null) return;
    setMatchBusy(true);
    setMatchError(null);
    const res = await matchApi.concede(match.id, { hole, side: mySide, version: match.version });
    if (!res.ok) setMatchError(res.error ?? 'That did not go through.');
    else if (hole !== null) setSel(null);
    await onRefresh();
    setMatchBusy(false);
  };
  const saveExtraHole = async () => {
    if (!match || !matchApi || !match.state.nextExtraHole) return;
    const counting = match.sides.flatMap(s => s.card_participant_ids);
    const par = parOf(match.state.nextExtraHole.hole_number);
    const strokes: Record<string, number | null> = {};
    for (const id of counting) strokes[id] = extra[id] ?? par;
    setMatchBusy(true);
    setMatchError(null);
    const res = await matchApi.extraHole(match.id, { n: match.state.nextExtraHole.n, hole_number: match.state.nextExtraHole.hole_number, strokes, version: match.version });
    if (!res.ok) setMatchError(res.error ?? 'That did not go through.');
    else setExtra({});
    await onRefresh();
    setMatchBusy(false);
  };
  const scoresOf = useCallback((c: (typeof columns)[number]) => overlayOutbox(c.scores.hole_scores ?? [], entries, c.participant.id), [entries]);
  const valueAt = (c: (typeof columns)[number], hole: number) => scoresOf(c).find(h => h.hole_number === hole) ?? null;

  const select = (c: (typeof columns)[number], hole: number) => {
    const isSelf = c.participant.profile_id === viewerId;
    const state = cellState(entries, c.participant.id, hole);
    if (state === 'conflict') { setConflictFor({ participantId: c.participant.id, hole }); return; }
    if (!isSelf && !recorder && !unlocked.has(c.participant.id)) { setAskUnlock({ participantId: c.participant.id, name: nameOf(c), hole }); return; }
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
          <Link href={`/events/${event.id}?tab=${match ? 'matches' : 'leaderboard'}`} className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong min-h-[44px]" data-gsc-back="">
            <i className="fas fa-chevron-left text-xs" aria-hidden="true"></i>{event.name}
          </Link>
          <span className="text-xs text-muted">{group?.name ?? (group ? `Group ${group.sequence}` : '')}</span>
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-y-auto px-2 pb-2">
        {match && (
          <div className="mb-2 rounded-lg border border-border bg-surface-muted px-3 py-2 space-y-1" data-match-strip="" data-match-strip-status={match.state.status}>
            <p className="text-sm font-bold text-primary" data-match-strip-summary="">{match.state.summary}</p>
            <p className="text-xs text-muted">{match.line}{match.state.netReason ? ` · gross (${match.state.netReason === 'no_index' ? 'no index' : 'no stroke index'})` : ''}</p>
            {matchLive && mySide !== null && (
              <div className="flex flex-wrap gap-2 pt-1">
                {sel && !conceded.has(sel.hole) && !match.state.holes.some(h => !h.extra && h.hole === sel.hole) && (
                  <button type="button" disabled={matchBusy} onClick={() => concede(sel.hole)} className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-xs font-semibold disabled:opacity-60" data-gsc-concede={sel.hole}>Concede hole {sel.hole}</button>
                )}
                <button type="button" disabled={matchBusy} onClick={() => setAskConcedeMatch(true)} className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-xs font-semibold disabled:opacity-60" data-gsc-concede-match="">Concede the match</button>
              </div>
            )}
            {matchError && <p role="alert" className="text-xs text-red-700 dark:text-red-300" data-match-strip-error="">{matchError}</p>}
          </div>
        )}
        <div className="grid gap-px bg-border rounded-lg overflow-hidden text-sm" style={{ gridTemplateColumns: cols }} role="grid" aria-label="Group scorecard">
          <div className="bg-surface-muted px-2 py-2 text-xs font-semibold text-muted">Hole</div>
          {columns.map(c => (
            <div key={c.participant.id} className="bg-surface-muted px-1 py-2 text-center min-w-0" data-gsc-col={c.participant.profile_id}>
              <span className="block text-xs font-bold text-primary truncate">{headerOf(c)}{c.participant.profile_id === viewerId ? ' (you)' : ''}</span>
            </div>
          ))}
          {holes.map(hole => (
            <HoleRow key={hole} hole={hole} par={parOf(hole)} conceded={conceded.has(hole)} cols={columns} sel={sel} entries={entries} valueAt={valueAt} onSelect={select} />
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
      ) : match && matchLive && match.state.needsExtraHole && match.state.nextExtraHole ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 pt-3 pb-3 safe-bottom" data-extra-hole-editor={match.state.nextExtraHole.n}>
          <p className="text-sm font-bold text-primary mb-2">All square — extra hole {match.state.nextExtraHole.n} · hole {match.state.nextExtraHole.hole_number} · par {parOf(match.state.nextExtraHole.hole_number)}</p>
          <div className="flex items-stretch gap-3 overflow-x-auto">
            {match.sides.flatMap(s => s.card_participant_ids.map(id => ({ id, name: s.members.find(m => m.participant_id === id)?.name ?? 'Player' }))).map(p => (
              <div key={p.id} data-extra-hole-wheel={p.id}>
                <NumberWheel label={p.name} min={1} max={15} value={extra[p.id] ?? null} defaultValue={parOf(match.state.nextExtraHole!.hole_number)} onChange={v => setExtra(x => ({ ...x, [p.id]: v }))} tone="green" />
              </div>
            ))}
          </div>
          <button type="button" disabled={matchBusy} onClick={saveExtraHole} className="mt-3 w-full ea-cta text-white min-h-[48px] rounded-lg text-sm font-semibold disabled:opacity-60" data-extra-hole-save="">Save extra hole {match.state.nextExtraHole.n}</button>
        </div>
      ) : match ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3 safe-bottom">
          <p className="text-xs text-muted">{match.state.status === 'completed' ? 'The match is decided.' : mine ? 'Tap a hole to score. A hole you cannot win is conceded from the match line.' : 'Match play — the sides score their own cards.'}</p>
        </div>
      ) : mine || recorder ? (
        <div className="shrink-0 border-t border-border bg-surface px-4 py-3 safe-bottom flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted" data-gsc-footer={mine ? 'player' : 'recorder'}>{!mine ? 'Recording for this group — tap a hole to score.' : myStatus === 'submitted' ? 'Your card is submitted.' : myStatus === 'final' ? 'Your card is final.' : myComplete ? (myPending ? 'Saving your last holes…' : 'Your card is complete.') : 'Tap a hole to score.'}</p>
          {mine && myStatus === 'in_progress' && (
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

      {askConcedeMatch && (
        <ConfirmModal
          isOpen
          title="Concede the match?"
          message="Your side gives the match — it is decided at once and cannot be reopened. The holes played stay on the cards."
          confirmText="Concede"
          confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
          onConfirm={() => { setAskConcedeMatch(false); void concede(null); }}
          onCancel={() => setAskConcedeMatch(false)}
        />
      )}
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

function HoleRow({ hole, par, conceded = false, cols, sel, entries, valueAt, onSelect }: { hole: number; par: number; conceded?: boolean; cols: Col[]; sel: Sel; entries: ReturnType<typeof useScoreOutbox>['entries']; valueAt: (c: Col, hole: number) => { strokes: number | null } | null; onSelect: (c: Col, hole: number) => void }) {
  return (
    <>
      <div className="bg-surface px-2 py-1 min-h-[44px] flex flex-col justify-center" data-gsc-hole={hole} data-gsc-conceded={conceded ? '' : undefined}>
        <span className="text-sm font-bold text-primary leading-none">{hole}</span>
        <span className="text-[10px] text-muted leading-none mt-1">par {par}{conceded ? ' · conceded' : ''}</span>
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
