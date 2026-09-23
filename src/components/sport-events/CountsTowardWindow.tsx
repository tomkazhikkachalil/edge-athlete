'use client';

import { useEffect, useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import { eligibleCompetition, type CompetitionForLink } from '@/lib/sport-events/contest-link';
import type { SportEventViewPayload } from '@/lib/sport-events/view';
import { isStablefordFormat } from '@/lib/sport-events/types';

/**
 * "Counts toward" (Events program, phase 2b, B1): the organizer picks one
 * of the host org's golf leaderboard competitions — or none. The list is
 * the org's competitions (the console's list, manager-gated — the same
 * authority the link needs) filtered by the pure eligibility rule. Save is
 * ONE PUT; the server names every refusal. The house bottom sheet.
 */
interface Props {
  view: SportEventViewPayload;
  onClose: () => void;
  onSave: (competitionId: string | null) => Promise<{ ok: boolean; error: string | null }>;
}

const INPUT = 'min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base w-full';

export default function CountsTowardWindow({ view, onClose, onSave }: Props) {
  const org = view.host_org;
  const [options, setOptions] = useState<CompetitionForLink[] | null>(null);
  const [value, setValue] = useState<string>(view.counts_toward?.competition_id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!org) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${org.side}s/${org.id}/competitions`, { cache: 'no-store' });
        if (!res.ok) { if (!cancelled) setOptions([]); return; }
        const data = (await res.json()) as { competitions?: Array<CompetitionForLink & Record<string, unknown>> };
        // Track 2 PR 10: the event's sport and shape pick the competitions (a game → a fixture of named sides in its sport).
        // The org's own competitions list carries no org column; the event's org is stamped on so the bridge's rule sees a match (Round 5 D0-b: org_id).
        const ev = { org_id: org.id, sport_key: view.event.sport_key, shape: view.event.shape, format: view.event.format, bracket: view.event.match?.bracket ?? false };
        const list = (data.competitions ?? []).map(c => ({ ...c, org_id: org.id, org: { kind: org.side } })).filter(c => eligibleCompetition(ev, c));
        if (!cancelled) setOptions(list);
      } catch {
        if (!cancelled) setOptions([]);
      }
    })();
    return () => { cancelled = true; };
  }, [org, view.event.sport_key, view.event.shape, view.event.format, view.event.match?.bracket]);

  const save = async () => {
    setBusy(true);
    setError(null);
    const res = await onSave(value === '' ? null : value);
    setBusy(false);
    if (!res.ok) { setError(res.error ?? 'Could not save.'); return; }
    onClose();
  };

  return (
    <LargerWindow title="Counts toward" subtitle={org ? org.name : undefined} onClose={onClose} windowKey="event-counts-toward">
      <div className="space-y-4" data-counts-toward-window="">
        {!org && <p className="text-sm text-muted">Only an event hosted for a club or league can count toward a competition.</p>}
        {org && options === null && <div className="flex justify-center py-6" aria-busy="true"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div>}
        {org && options && (
          <label className="block space-y-1">
            <span className="text-sm font-medium text-secondary">Competition</span>
            <select value={value} onChange={e => setValue(e.target.value)} className={INPUT} data-counts-toward-select="">
              <option value="">None — just an event</option>
              {options.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {options.length === 0 && <p className="text-xs text-muted">{isStablefordFormat(view.event.format) ? 'A Stableford event does not count toward a competition — it ranks by points.' : view.event.match ? (view.event.match.bracket ? `No golf bracket competition on ${org.name} yet — a manager draws one in the console.` : 'Only a bracket event counts toward a bracket competition — turn on the bracket in the format settings.') : view.event.shape === 'game' ? `No fixture of named sides in this sport on ${org.name} yet — a manager creates one in the console.` : `No golf leaderboard competition on ${org.name} yet — a manager creates one in the console.`}</p>}
          </label>
        )}
        <p className="text-xs text-muted">{view.event.match?.bracket ? 'Match k of round n plays slot k of stage n. Nothing is created now — each match is linked to its bracket slot when its round starts; the bracket’s rounds must equal this event’s.' : 'One contest per round is created on the competition; the org’s results are written from the leaderboard when a round completes. The link can change until play begins.'}</p>
        {error && <p role="alert" className="text-sm text-red-700 dark:text-red-300" data-counts-toward-error="">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold">Cancel</button>
          <button type="button" onClick={save} disabled={busy || !org || options === null} className="ea-cta text-white px-5 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60" data-counts-toward-save="">{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </LargerWindow>
  );
}
