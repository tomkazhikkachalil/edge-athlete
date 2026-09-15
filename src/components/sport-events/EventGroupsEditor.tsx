'use client';

import { useMemo, useState } from 'react';
import ReorderList from '@/components/site-builder/ReorderList';
import type { EventApi } from '@/lib/sport-events/client';
import ConfirmModal from '@/components/ConfirmModal';
import { addGroup, assign, drawFromWinners, editorGroupsIncomplete, groupsByStanding, groupsFromSaved, moveGroup, pruneTo, removeGroup, reorderMembers, samePlan, setSide, SIDE_REFUSAL_COPY, sideInEditor, toPlanBody, unassign, unassigned, updateGroup, type EditorGroup, type EditorPlayer, type StandingGroupOptions } from '@/lib/sport-events/groups-editor';
import { MATCH_SIDES_LABEL } from '@/lib/sport-events/format';
import { bracketMatchesFrom } from '@/lib/sport-events/match-view';
import type { RoundSelection } from '@/lib/sport-events/tabs';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import RoundSwitcher from './RoundSwitcher';

/**
 * The organizer's groups editor (Events program, PR 12): the unassigned
 * pool on top, the groups below — each with a name, a tee time, a
 * starting hole and its players in order (ReorderList: Move up / down at
 * every width, drag on a desktop). Everything is local until Save, which
 * replaces the round's whole plan in one PUT; the mint reads it at
 * go-live. Read-only once THE ROUND has started (phase 2: round 2 is
 * regrouped while round 1 is live; the switcher picks the round). "Group
 * by standing" (a round after a completed one) lays the next round's
 * groups from the overall board: leaders last (the PGA norm) or first,
 * a group size, optional tee times — the draft is replaced, Save is the
 * same PUT, the mint honours it. Phase 3 — a MATCH format: a group is a
 * match ("Match n"), every member gets a Side 1 / Side 2 control (the
 * position's side by default; the first on a side is the captain on
 * foursomes), an incomplete group is flagged with what it needs, and
 * "Group by standing" is hidden (no standing exists). On a BRACKET round
 * after a completed match round, "Fill from winners" pre-fills the draw in
 * bracket order (match k from the winners of 2k−1 and 2k; an undecided
 * feeder shows "Winner of match n"; an odd tail is a bye) — the draft is
 * replaced and stays editable; Save is the same PUT.
 */
interface Props {
  view: SportEventViewPayload;
  api: EventApi;
  onSaved: (view: SportEventViewPayload) => void;
  selected: RoundSelection | null;
  onSelect: (next: RoundSelection) => void;
}

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';
const INPUT = 'min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

export default function EventGroupsEditor({ view, api, onSaved, selected, onSelect }: Props) {
  const round = selected && selected !== 'overall' ? view.rounds.find(r => r.id === selected) ?? null : null;
  const editable = view.viewer.can_manage && round?.status === 'scheduled' && view.event.status !== 'completed' && view.event.status !== 'cancelled';
  const players: EditorPlayer[] = useMemo(
    () => view.participants.filter(p => p.status === 'accepted' && p.playing && p.role !== 'follower').map(p => ({ participantId: p.id, name: p.name })),
    [view.participants],
  );
  const eligible = useMemo(() => new Set(players.map(p => p.participantId)), [players]);
  const saved = useMemo(() => (round ? pruneTo(groupsFromSaved(view.groups.filter(g => g.sport_event_round_id === round.id)), eligible) : []), [view.groups, round, eligible]);
  // A null draft FOLLOWS the saved plan (a refetch after an accept or a
  // removal re-seeds it for free); the first edit forks it. No effect —
  // the derivation happens at render, and a dirty draft is pruned to the
  // players still eligible.
  const [draft, setDraft] = useState<EditorGroup[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [standingOpts, setStandingOpts] = useState<StandingGroupOptions & { first: string; intervalMin: number }>({ groupSize: 4, order: 'leaders_last', first: '', intervalMin: 10 });
  const [confirmStanding, setConfirmStanding] = useState(false);
  const [confirmWinners, setConfirmWinners] = useState(false);
  const [feeders, setFeeders] = useState<Record<string, [number, number]>>({});
  const groups = draft ? pruneTo(draft, eligible) : saved;
  const setGroups = (fn: (prev: EditorGroup[]) => EditorGroup[]) => setDraft(fn(groups));
  const match = view.event.match;
  const matchSides = match?.sides ?? null;
  const incomplete = match ? editorGroupsIncomplete(groups, match.sides, match.bracket) : [];
  const unit = match ? 'Match' : 'Group';

  const dirty = !samePlan(groups, saved);
  const nameOf = (id: string) => players.find(p => p.participantId === id)?.name ?? 'Player';
  const pool = unassigned(players, groups);

  const canRegroup = !match && !!round && editable && round.sequence > 1 && view.rounds.some(r => r.sequence < round.sequence && r.status === 'completed');
  const regroup = async () => {
    setError(null);
    setNotice(null);
    const res = await api.overall();
    if (!res.ok || !res.data) { setError(res.error ?? 'Could not read the standing.'); return; }
    const rows = res.data.board.rows.filter(r => eligible.has(r.participantId)).map(r => ({ participantId: r.participantId, rank: r.rank, madeCut: r.madeCut }));
    const next = groupsByStanding(rows, { groupSize: standingOpts.groupSize, order: standingOpts.order, teeTimes: /^\d{2}:\d{2}$/.test(standingOpts.first) ? { first: standingOpts.first, intervalMin: standingOpts.intervalMin } : null });
    setDraft(next);
    setNotice(`${next.length} group${next.length === 1 ? '' : 's'} from the standing — save when ready.`);
  };
  const askRegroup = () => { if (groups.some(g => g.members.length > 0)) setConfirmStanding(true); else void regroup(); };

  // Phase 3: a bracket round is fed by the previous round's winners.
  const prevRound = match?.bracket && round ? [...view.rounds].filter(r => r.status !== 'cancelled' && r.sequence < round.sequence).sort((a, b) => b.sequence - a.sequence)[0] ?? null : null;
  const canFillWinners = !!prevRound && editable && prevRound.status === 'completed';
  const fillWinners = async () => {
    if (!prevRound) return;
    setError(null);
    setNotice(null);
    const res = await api.matches(prevRound.id);
    if (!res.ok || !res.data) { setError(res.error ?? 'Could not read the previous round.'); return; }
    const { byRound } = bracketMatchesFrom(res.data.matches);
    const next = drawFromWinners(byRound.get(prevRound.id) ?? []);
    setFeeders(next.feeders);
    setDraft(next.groups);
    setNotice(`${next.groups.length} match${next.groups.length === 1 ? '' : 'es'} from round ${prevRound.sequence}'s winners — save when ready.`);
  };
  const askFillWinners = () => { if (groups.some(g => g.members.length > 0)) setConfirmWinners(true); else void fillWinners(); };

  const save = async () => {
    if (!round) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const res = await api.saveGroups(round.id, toPlanBody(groups, round.scheduled_on, { matchSides }));
    setBusy(false);
    if (!res.ok || !res.data) { setError(res.error ?? 'Could not save the groups.'); return; }
    setNotice('Groups saved.');
    setDraft(null);
    onSaved(res.data);
  };

  const switcher = <RoundSwitcher rounds={view.rounds} selected={selected} onChange={onSelect} label="Groups round" />;
  if (!round) return <div className="space-y-3">{switcher}<p className="text-sm text-muted">No round yet.</p></div>;
  if (players.length === 0) return <div className="space-y-3">{switcher}<p className="text-sm text-muted">Groups are made from players who have accepted — none yet.</p></div>;

  return (
    <div className="space-y-5" data-event-groups-editor={round.id}>
      {switcher}
      {!editable && <p className="text-sm text-muted" data-groups-locked="">{match ? 'The draw is set before the round starts.' : 'Groups are set before the round starts.'}</p>}
      {canFillWinners && (
        <div className="flex flex-wrap items-center gap-2" data-groups-winners="">
          <button type="button" onClick={askFillWinners} disabled={busy} className={BTN} data-groups-fill-winners=""><i className="fas fa-trophy mr-2" aria-hidden="true"></i>Fill from winners</button>
          <span className="text-xs text-muted">Round {prevRound!.sequence}&apos;s winners in bracket order — match 1 from matches 1 and 2, and so on. Edit it as you like.</span>
        </div>
      )}
      {match && <p className="text-xs text-muted" data-groups-match-hint="">{MATCH_SIDES_LABEL[match.sides]}: {match.sides === 'singles' ? 'one player a side' : 'two players a side'}{match.sides === 'foursomes' ? ' — the first on a side keeps the card' : ''}. {match.bracket ? 'A match with one side is a bye.' : 'Every match needs both sides before the round starts.'}</p>}
      {canRegroup && (
        <section className="bg-surface rounded-lg border border-border p-3 space-y-2" data-groups-standing="">
          <h2 className="text-sm font-bold text-primary">Group by standing</h2>
          <p className="text-xs text-muted">Lays this round&apos;s groups from the overall board. Players who missed the cut are left out.</p>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-xs text-secondary space-y-1">
              <span className="block">Players per group</span>
              <select value={standingOpts.groupSize} onChange={e => setStandingOpts(o => ({ ...o, groupSize: Number(e.target.value) as 2 | 3 | 4 | 5 }))} className={`${INPUT} text-sm`} aria-label="Players per group" data-standing-size="">
                {[2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="text-xs text-secondary space-y-1">
              <span className="block">Order</span>
              <select value={standingOpts.order} onChange={e => setStandingOpts(o => ({ ...o, order: e.target.value as 'leaders_last' | 'leaders_first' }))} className={`${INPUT} text-sm`} aria-label="Tee order" data-standing-order="">
                <option value="leaders_last">Leaders tee off last</option>
                <option value="leaders_first">Leaders tee off first</option>
              </select>
            </label>
            <label className="text-xs text-secondary space-y-1">
              <span className="block">First tee time <span className="text-muted">(optional)</span></span>
              <input type="time" value={standingOpts.first} onChange={e => setStandingOpts(o => ({ ...o, first: e.target.value }))} className={INPUT} aria-label="First tee time" />
            </label>
            <label className="text-xs text-secondary space-y-1">
              <span className="block">Minutes between groups</span>
              <select value={standingOpts.intervalMin} onChange={e => setStandingOpts(o => ({ ...o, intervalMin: Number(e.target.value) }))} className={`${INPUT} text-sm`} aria-label="Minutes between groups">
                {[8, 9, 10, 11, 12, 15].map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <button type="button" onClick={askRegroup} disabled={busy} className={BTN} data-groups-by-standing=""><i className="fas fa-list-ol mr-2" aria-hidden="true"></i>Group by standing</button>
          </div>
        </section>
      )}
      <section>
        <h2 className="text-sm font-bold text-primary mb-1">Not in a group ({pool.length})</h2>
        {pool.length === 0 ? <p className="text-sm text-muted">Everyone is placed.</p> : (
          <ul className="divide-y divide-border-subtle">
            {pool.map(p => (
              <li key={p.participantId} className="flex items-center justify-between gap-3 py-2" data-groups-pool={p.participantId}>
                <span className="text-sm text-primary truncate">{p.name}</span>
                {editable && (
                  <select
                    aria-label={`Put ${p.name} in a group`}
                    className={`${INPUT} text-sm`}
                    value=""
                    onChange={e => { if (e.target.value) setGroups(g => assign(g, p.participantId, e.target.value)); }}
                  >
                    <option value="">Add to…</option>
                    {groups.map((g, i) => <option key={g.key} value={g.key}>{g.name.trim() || `${unit} ${i + 1}`}</option>)}
                  </select>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <ol className="space-y-4">
        {groups.map((g, i) => (
          <li key={g.key} className="bg-surface-muted rounded-lg p-3 space-y-3" data-groups-group={i + 1}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-muted">{unit} {i + 1}</span>
              <input value={g.name} disabled={!editable} onChange={e => setGroups(gs => updateGroup(gs, g.key, { name: e.target.value }))} placeholder={match ? `Match ${i + 1}` : 'Name (optional)'} maxLength={60} aria-label={`${unit} ${i + 1} name`} className={`${INPUT} flex-1 min-w-[8rem]`} />
              <input type="time" value={g.teeTime} disabled={!editable} onChange={e => setGroups(gs => updateGroup(gs, g.key, { teeTime: e.target.value }))} aria-label={`Group ${i + 1} tee time`} className={INPUT} data-groups-tee="" />
              <select value={g.startingHole} disabled={!editable} onChange={e => setGroups(gs => updateGroup(gs, g.key, { startingHole: Number(e.target.value) }))} aria-label={`Group ${i + 1} starting hole`} className={INPUT}>
                {Array.from({ length: 18 }, (_, n) => n + 1).map(n => <option key={n} value={n}>Hole {n}</option>)}
              </select>
            </div>
            {g.members.length === 0 ? <p className="text-sm text-muted">No players yet — add them from the list above.</p> : (
              editable ? (
                <ReorderList items={g.members.map(id => ({ id, label: nameOf(id) }))} onChange={ids => setGroups(gs => reorderMembers(gs, g.key, ids))} label={`Group ${i + 1} players`} idBase={`event-group-${i + 1}`} />
              ) : (
                <ol className="text-sm text-primary space-y-1">{g.members.map((id, n) => <li key={id}>{n + 1}. {nameOf(id)}</li>)}</ol>
              )
            )}
            {match && g.members.length > 0 && (
              <ul className="space-y-1" data-groups-sides="">
                {g.members.map(id => {
                  const side = sideInEditor(g, id, matchSides);
                  return (
                    <li key={id} className="flex items-center justify-between gap-2" data-groups-side={id} data-groups-side-value={side ?? ''}>
                      <span className="text-sm text-primary truncate">{nameOf(id)}</span>
                      <div className="flex rounded-lg border border-border-strong overflow-hidden" role="group" aria-label={`${nameOf(id)}'s side`}>
                        {([1, 2] as const).map(s => (
                          <button key={s} type="button" disabled={!editable} aria-pressed={side === s} onClick={() => setGroups(gs => setSide(gs, g.key, id, s))} className={`min-h-[36px] px-3 text-xs font-semibold ${side === s ? 'bg-brand text-white' : 'bg-surface text-tertiary'}`} data-groups-side-pick={s}>Side {s}</button>
                        ))}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            {match?.bracket && feeders[g.key] && ([1, 2] as const).some(side => !g.members.some(id => sideInEditor(g, id, matchSides) === side)) && (
              <p className="text-xs text-muted" data-groups-winner-of="">
                {([1, 2] as const).filter(side => !g.members.some(id => sideInEditor(g, id, matchSides) === side)).map(side => `Side ${side}: winner of match ${feeders[g.key][side - 1]}`).join(' · ')}
              </p>
            )}
            {match && incomplete.some(x => x.index === i + 1) && (
              <p className="text-xs text-amber-800 dark:text-amber-200" data-groups-incomplete={i + 1}>{SIDE_REFUSAL_COPY[incomplete.find(x => x.index === i + 1)!.reason](match.sides)}</p>
            )}
            {editable && g.members.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {g.members.map(id => <button key={id} type="button" onClick={() => setGroups(gs => unassign(gs, id))} className={`${BTN} min-h-[36px] text-xs`} aria-label={`Take ${nameOf(id)} out of ${unit.toLowerCase()} ${i + 1}`}>{nameOf(id)} ×</button>)}
              </div>
            )}
            {editable && (
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setGroups(gs => moveGroup(gs, g.key, -1))} disabled={i === 0} className={BTN} aria-label={`Move group ${i + 1} up`}>↑</button>
                <button type="button" onClick={() => setGroups(gs => moveGroup(gs, g.key, 1))} disabled={i === groups.length - 1} className={BTN} aria-label={`Move group ${i + 1} down`}>↓</button>
                <button type="button" onClick={() => setGroups(gs => removeGroup(gs, g.key))} className={BTN} aria-label={`Remove group ${i + 1}`}>Remove group</button>
              </div>
            )}
          </li>
        ))}
      </ol>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setGroups(gs => addGroup(gs))} className={BTN} data-groups-add=""><i className="fas fa-plus mr-2" aria-hidden="true"></i>{match ? 'Add match' : 'Add group'}</button>
          <button type="button" onClick={save} disabled={!dirty || busy} className="ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-groups-save="">{busy ? 'Saving…' : dirty ? 'Save groups' : 'Saved'}</button>
        </div>
      )}
      {(error || notice) && <p role="status" className={`text-sm ${error ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'}`} data-groups-notice="">{error ?? notice}</p>}
      {confirmWinners && (
        <ConfirmModal
          isOpen
          title="Replace the draw with the winners?"
          message="The matches you have arranged are replaced by the previous round's winners in bracket order. Nothing is saved until you press Save groups."
          confirmText="Replace"
          onConfirm={async () => { setConfirmWinners(false); await fillWinners(); }}
          onCancel={() => setConfirmWinners(false)}
        />
      )}
      {confirmStanding && (
        <ConfirmModal
          isOpen
          title="Replace the groups with the standing?"
          message="The groups you have arranged are replaced by groups laid from the overall board. Nothing is saved until you press Save groups."
          confirmText="Replace"
          onConfirm={async () => { setConfirmStanding(false); await regroup(); }}
          onCancel={() => setConfirmStanding(false)}
        />
      )}
    </div>
  );
}
