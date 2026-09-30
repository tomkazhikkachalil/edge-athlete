'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { BadgeCheck, Swords } from 'lucide-react';
import { getInitials } from '@/lib/formatters';
import { useToast } from '@/components/Toast';
import LazyImage from '@/components/LazyImage';
import { recordLine, type EncounterResult, type HeadToHead } from '@/lib/play/versus';
import type { RivalsView } from '@/lib/play/rivals';

/**
 * Rivals — the Play program (244). Lives in the Stats hub's SPORT layer on
 * all three stats routes (/athlete, /athlete/[id], /u/), because a rivalry
 * is a sport's stat (Tom: "displayed in the stats area under the sport").
 *
 * The athlete chooses what shows: they (or their guardian) see every rival
 * with a Show / Hide toggle — none shown by default; everyone else sees
 * only the shown ones. A viewer who has played the athlete always sees
 * their OWN record on top, from their side.
 */

const RESULT_LOOK: Record<EncounterResult, string> = {
  W: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200',
  L: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200',
  T: 'bg-surface-sunken text-secondary',
};

function Form({ results }: { results: EncounterResult[] }) {
  if (results.length === 0) return null;
  return (
    <span className="inline-flex gap-1" role="img" aria-label={`Last ${results.length}: ${results.join(' ')}`}>
      {results.map((r, i) => (
        <span key={i} className={`w-6 h-6 inline-flex items-center justify-center rounded text-xs font-bold ${RESULT_LOOK[r]}`} aria-hidden>
          {r}
        </span>
      ))}
    </span>
  );
}

function RecordSummary({ record }: { record: HeadToHead }) {
  const t = record.together;
  const togetherPlayed = t.wins + t.losses + t.ties;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
      <span className="text-base font-bold text-primary tabular-nums" data-rival-record>{recordLine(record.versus)}</span>
      <Form results={record.lastFive} />
      {togetherPlayed > 0 && <span>Together {recordLine(t)}</span>}
      {record.versus.undecided > 0 && <span>{record.versus.undecided} more played</span>}
      {record.verified > 0 && (
        <span className="inline-flex items-center gap-1 text-brand">
          <BadgeCheck className="w-4 h-4" aria-hidden /> {record.verified} verified
        </span>
      )}
    </span>
  );
}

export default function RivalsPanel({ profileId, sportKey }: { profileId: string; sportKey: string }) {
  const { showError } = useToast();
  const [view, setView] = useState<RivalsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${profileId}/rivals?sport=${encodeURIComponent(sportKey)}`, { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as RivalsView;
        if (!cancelled) setView(body);
      } catch (e) {
        console.error('Failed to load rivals:', e);
        if (!cancelled) setView({ selfView: false, canManage: false, rivals: [], yours: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, sportKey]);

  if (!view) return null;
  if (!view.selfView && view.rivals.length === 0 && !view.yours) return null;

  const toggle = async (opponentId: string, shown: boolean) => {
    setBusy(opponentId);
    // Optimistic: flip now, put it back if the server refuses.
    setView(v => (v ? { ...v, rivals: v.rivals.map(r => (r.person.profileId === opponentId ? { ...r, shown } : r)) } : v));
    try {
      const res = await fetch(`/api/profile/${profileId}/rivals`, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ opponentId, sportKey, shown }),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      setView(v => (v ? { ...v, rivals: v.rivals.map(r => (r.person.profileId === opponentId ? { ...r, shown: !shown } : r)) } : v));
      showError('Could not update your rivals', 'Please try again.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="ea-surface rounded-xl bg-surface p-4 sm:p-6 mb-6" aria-labelledby={`rivals-${sportKey}`} data-rivals={sportKey}>
      <div className="flex items-center gap-2 mb-1">
        <Swords className="w-5 h-5 text-brand" aria-hidden />
        <h3 id={`rivals-${sportKey}`} className="text-h3 text-primary">Rivals</h3>
      </div>
      <p className="text-sm text-muted mb-4">
        {view.selfView
          ? view.canManage
            ? 'Head-to-head with the people you play. Only the rivals you show appear on your profile.'
            : 'Head-to-head with the people you play. Your guardian chooses which ones show on your profile.'
          : 'Head-to-head records.'}
      </p>

      {view.yours && (
        <div className="rounded-lg bg-brand-soft px-4 py-3 mb-4" data-rivals-yours>
          <p className="text-label font-semibold text-brand-fg-strong mb-1">You vs this athlete</p>
          <RecordSummary record={view.yours} />
        </div>
      )}

      {view.rivals.length === 0 ? (
        view.selfView && (
          <p className="text-sm text-muted border border-dashed border-border rounded-lg px-4 py-5 text-center">
            Play a round or a game with someone and your rivalry starts here.
          </p>
        )
      ) : (
        <ul className="divide-y divide-border">
          {view.rivals.map(r => (
            <li key={r.person.profileId} className="py-3 flex items-center gap-3 min-w-0" data-rival={r.person.profileId}>
              <span className="w-10 h-10 shrink-0 rounded-full bg-surface-sunken flex items-center justify-center overflow-hidden text-sm font-semibold text-secondary">
                {r.person.avatarUrl ? (
                  <LazyImage src={r.person.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover" width={40} height={40} />
                ) : (
                  getInitials(r.person.name)
                )}
              </span>
              <div className="min-w-0 flex-1">
                {r.person.handle ? (
                  <Link href={`/u/@${r.person.handle}`} className="font-bold text-primary hover:underline truncate block">
                    {r.person.name}
                  </Link>
                ) : (
                  <span className="font-bold text-primary truncate block">{r.person.name}</span>
                )}
                <RecordSummary record={r.record} />
              </div>
              {view.selfView && view.canManage && (
                <button
                  type="button"
                  onClick={() => toggle(r.person.profileId, !r.shown)}
                  disabled={busy === r.person.profileId}
                  aria-pressed={r.shown}
                  className={`ea-interactive shrink-0 min-h-[44px] px-3 rounded-lg text-sm font-semibold border ${
                    r.shown ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border'
                  }`}
                >
                  {r.shown ? 'Shown' : 'Show'}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
