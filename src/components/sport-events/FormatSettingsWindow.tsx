'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { cutEditable } from '@/lib/sport-events/cut';
import { CUT_TO_PAR_MAX, CUT_TO_PAR_MIN, CUT_TOP_N_MAX, cutLabel, MATCH_ALLOWANCE_DEFAULT } from '@/lib/sport-events/format-config';
import { formatLabel, MATCH_SIDES_LABEL } from '@/lib/sport-events/format';
import { isMatchFormat, MATCH_SIDES, type MatchSides, isStablefordFormat } from '@/lib/sport-events/types';
import { activeRounds } from '@/lib/sport-events/rounds';
import type { FormatConfig } from '@/lib/sport-events/types';
import type { SportEventViewPayload } from '@/lib/sport-events/view';

/**
 * The organizer's format settings (Events program, phase 2 — 207
 * `format_config`): the cut — after round K, the top N (ties at the nth
 * place all make it) or everyone at or under a to-par. The house bottom
 * sheet; Save is one PATCH; a cut whose round has already completed is
 * refused by the server (`cut_already_passed`) and greyed here. Closing
 * with unsaved input asks first. Phase 3: on a match format the window
 * hosts the match shape instead — sides and the bracket while draft /
 * open, the handicap allowance while live too (`match_locked` otherwise).
 */
interface Props {
  event: SportEventViewPayload['event'];
  rounds: SportEventViewPayload['rounds'];
  onClose: () => void;
  onSave: (formatConfig: FormatConfig) => Promise<{ ok: boolean; error: string | null }>;
}

const INPUT = 'min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base';

export default function FormatSettingsWindow({ event, rounds, onClose, onSave }: Props) {
  if (isMatchFormat(event.format)) return <MatchSettings event={event} rounds={rounds} onClose={onClose} onSave={onSave} />;
  return <CutSettings stableford={isStablefordFormat(event.format)} event={event} rounds={rounds} onClose={onClose} onSave={onSave} />;
}

function MatchSettings({ event, rounds, onClose, onSave }: Props) {
  const initial = event.match ?? { sides: 'singles' as MatchSides, bracket: false, allowance: 100 };
  const shapeLocked = event.status === 'live';
  const [sides, setSides] = useState<MatchSides>(initial.sides);
  const [bracket, setBracket] = useState(initial.bracket);
  const [allowance, setAllowance] = useState(String(initial.allowance));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const build = (): FormatConfig => {
    const n = Number(allowance);
    return { match: { sides, bracket, ...(Number.isInteger(n) && n !== MATCH_ALLOWANCE_DEFAULT[sides] ? { allowance: n } : {}) } };
  };
  const dirty = () => sides !== initial.sides || bracket !== initial.bracket || Number(allowance) !== initial.allowance;
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);
  const save = async () => {
    setError(null);
    const n = Number(allowance);
    if (!Number.isInteger(n) || n < 0 || n > 100) { setError('The allowance is a whole number from 0 to 100.'); return; }
    if (bracket && activeRounds(rounds).length < 2) { setError('A bracket needs at least two rounds — add them first.'); return; }
    setBusy(true);
    const res = await onSave(build());
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not save the format.'); return; }
    onClose();
  };
  return (
    <>
      <LargerWindow title="Format settings" subtitle={formatLabel(event.format, initial)} onClose={requestClose} windowKey="event-format">
        <div className="space-y-4" data-format-settings="" data-match-settings="">
          {shapeLocked && <p className="text-sm text-muted" data-match-locked="">The event has started — the sides and the bracket are set. The allowance can still change.</p>}
          <div role="radiogroup" aria-label="Sides" className="grid gap-2 sm:grid-cols-3">
            {MATCH_SIDES.map(k => (
              <label key={k} className={`flex items-start gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer ${sides === k ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface'}`}>
                <input type="radio" name="match-sides" value={k} checked={sides === k} disabled={shapeLocked} onChange={() => { setSides(k); setAllowance(String(MATCH_ALLOWANCE_DEFAULT[k])); }} className="mt-1 h-4 w-4" data-match-sides={k} />
                <span className="min-w-0"><span className="block text-sm font-semibold text-primary">{MATCH_SIDES_LABEL[k]}</span><span className="block text-xs text-muted">{k === 'singles' ? 'One against one.' : k === 'fourball' ? 'Two a side, the better ball.' : 'Two a side, one ball.'}</span></span>
              </label>
            ))}
          </div>
          <label className="flex items-center gap-3 min-h-[44px]">
            <input type="checkbox" checked={bracket} disabled={shapeLocked} onChange={e => setBracket(e.target.checked)} className="h-4 w-4" data-match-bracket="" />
            <span className="text-sm text-primary">A knockout bracket — the rounds are its rounds</span>
          </label>
          <label className="block space-y-1">
            <span className="text-sm font-medium text-secondary">Handicap allowance (%)</span>
            <input type="number" inputMode="numeric" min={0} max={100} value={allowance} onChange={e => setAllowance(e.target.value)} className={`${INPUT} w-full`} data-match-allowance="" />
            <span className="text-xs text-muted">The WHS default for {MATCH_SIDES_LABEL[sides].toLowerCase()} is {MATCH_ALLOWANCE_DEFAULT[sides]}%. Only a net match uses it.</span>
          </label>
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-format-error="">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={requestClose} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold">Cancel</button>
            <button type="button" onClick={save} disabled={busy || !dirty()} className="ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-format-save="">{busy ? 'Saving…' : 'Save format'}</button>
          </div>
        </div>
      </LargerWindow>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  );
}

function CutSettings({ event, rounds, onClose, onSave, stableford = false }: Props & { stableford?: boolean }) {
  const active = activeRounds(rounds);
  const initialCut = event.format_config.cut ?? null;
  const [enabled, setEnabled] = useState(initialCut !== null);
  const [after, setAfter] = useState(initialCut?.after_round ?? 1);
  const [mode, setMode] = useState<'top_n' | 'to_par'>(initialCut && typeof initialCut.to_par === 'number' ? 'to_par' : 'top_n');
  const [value, setValue] = useState(initialCut ? String(typeof initialCut.to_par === 'number' ? initialCut.to_par : initialCut.top_n ?? '') : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const build = (): FormatConfig => {
    if (!enabled) return {};
    const n = Number(value);
    return { cut: mode === 'top_n' ? { after_round: after, top_n: n } : { after_round: after, to_par: n } };
  };
  const dirty = () => JSON.stringify(build()) !== JSON.stringify(initialCut ? { cut: initialCut } : {});
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);
  const afterOptions = active.filter(r => r.sequence < active.length);
  const locked = initialCut ? !cutEditable(initialCut, active) : false;

  const save = async () => {
    setError(null);
    if (enabled) {
      const n = Number(value);
      if (!Number.isInteger(n)) { setError(mode === 'top_n' ? 'How many play on? A whole number.' : 'The to-par is a whole number.'); return; }
      if (mode === 'top_n' && (n < 1 || n > CUT_TOP_N_MAX)) { setError(`Top N is a whole number from 1 to ${CUT_TOP_N_MAX}.`); return; }
      if (mode === 'to_par' && (n < CUT_TO_PAR_MIN || n > CUT_TO_PAR_MAX)) { setError(`The to-par is a whole number from ${CUT_TO_PAR_MIN} to ${CUT_TO_PAR_MAX}.`); return; }
      if (!cutEditable({ after_round: after, top_n: 1 }, active)) { setError('That round has already completed — the cut cannot fall after it.'); return; }
    }
    setBusy(true);
    const res = await onSave(build());
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not save the format.'); return; }
    onClose();
  };

  return (
    <>
      <LargerWindow title="Format settings" subtitle={cutLabel(initialCut) ?? 'No cut — everyone plays every round'} onClose={requestClose} windowKey="event-format">
        <div className="space-y-4" data-format-settings="">
          {locked && <p className="text-sm text-muted" data-cut-locked="">The cut has been made — it can no longer change.</p>}
          <label className="flex items-center gap-3 min-h-[44px]">
            <input type="checkbox" checked={enabled} disabled={locked} onChange={e => setEnabled(e.target.checked)} className="h-4 w-4" data-cut-enabled="" />
            <span className="text-sm text-primary">A cut — only some players go on to the later rounds</span>
          </label>
          {enabled && (
            <div className="space-y-3" data-cut-fields="">
              <label className="block space-y-1">
                <span className="text-sm font-medium text-secondary">After round</span>
                <select value={after} disabled={locked} onChange={e => setAfter(Number(e.target.value))} className={`${INPUT} w-full`} data-cut-after="">
                  {afterOptions.map(r => <option key={r.id} value={r.sequence} disabled={r.status === 'completed'}>Round {r.sequence}{r.name ? ` · ${r.name}` : ''}{r.status === 'completed' ? ' (completed)' : ''}</option>)}
                </select>
              </label>
              <div role="radiogroup" aria-label="Who plays on" className="grid gap-2 sm:grid-cols-2">
                {([['top_n', 'The top N', 'Ties at the nth place all make it.'], ['to_par', 'At or under a score to par', 'Everyone at or better than it plays on.']] as const).filter(([m]) => m === 'top_n' || !stableford).map(([m, label, hint]) => (
                  <label key={m} className={`flex items-start gap-3 rounded-lg border p-3 min-h-[44px] cursor-pointer ${mode === m ? 'border-brand bg-brand-soft' : 'border-border-strong bg-surface'}`}>
                    <input type="radio" name="cut-mode" value={m} checked={mode === m} disabled={locked} onChange={() => setMode(m)} className="mt-1 h-4 w-4" data-cut-mode={m} />
                    <span className="min-w-0"><span className="block text-sm font-semibold text-primary">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
                  </label>
                ))}
              </div>
              <label className="block space-y-1">
                <span className="text-sm font-medium text-secondary">{mode === 'top_n' ? 'How many play on' : 'Score to par (0 = even, +4, −2)'}</span>
                <input type="number" inputMode="numeric" value={value} disabled={locked} onChange={e => setValue(e.target.value)} className={`${INPUT} w-full`} placeholder={mode === 'top_n' ? '20' : '4'} data-cut-value="" />
              </label>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-format-error="">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            <button type="button" onClick={requestClose} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold">Cancel</button>
            <button type="button" onClick={save} disabled={busy || locked || !dirty()} className="ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-format-save="">{busy ? 'Saving…' : 'Save format'}</button>
          </div>
        </div>
      </LargerWindow>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText={COPY.FORMS.KEEP_EDITING}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>
  );
}
