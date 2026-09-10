'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getEnabledSports } from '@/lib/sports/SportRegistry';
import { RECRUITING_STATUS_LABEL, gradYearLabel } from '@/lib/recruiting/profile';
import type { RecruitableAthlete } from '@/lib/recruiting/search-server';
import ShortlistButton from './ShortlistButton';

// ── "Find athletes" (Recruiting skeleton R4) ──────────────────────────────
// The Explore chip scroller pointed at the recruitable population: a name
// box, sport chips, a grad-year window; every row carries the Shortlist
// toggle. Debounced; the effect owns the fetch.

const SPORTS = getEnabledSports();
const inputClass = 'px-3 py-2 border border-border-strong rounded-md bg-surface text-sm focus:outline-none';

export default function ScoutSearch() {
  const [q, setQ] = useState('');
  const [sport, setSport] = useState<string | null>(null);
  const [gradFrom, setGradFrom] = useState('');
  const [gradTo, setGradTo] = useState('');
  const [state, setState] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
  const [athletes, setAthletes] = useState<RecruitableAthlete[]>([]);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (q.trim()) params.set('q', q.trim());
    if (sport) params.set('sport', sport);
    if (gradFrom) params.set('gradFrom', gradFrom);
    if (gradTo) params.set('gradTo', gradTo);
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/scout/search?${params.toString()}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('error');
          return;
        }
        const data = (await res.json()) as { supported: boolean; athletes: RecruitableAthlete[] };
        if (cancelled) return;
        setAthletes(data.athletes ?? []);
        setState(data.supported ? 'ready' : 'unsupported');
      } catch {
        if (!cancelled) setState('error');
      }
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, sport, gradFrom, gradTo]);

  return (
    <div className="space-y-4" data-scout-search="">
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="sr-only" htmlFor="scout-q">Athlete name</label>
        <input id="scout-q" type="search" value={q} onChange={e => setQ(e.target.value)} placeholder="Athlete name" className={`${inputClass} flex-1 min-w-0`} />
        <div className="flex gap-2">
          <label className="sr-only" htmlFor="scout-grad-from">Grad year from</label>
          <input id="scout-grad-from" type="number" inputMode="numeric" min="2000" max="2100" value={gradFrom} onChange={e => setGradFrom(e.target.value)} placeholder="Grad from" className={`${inputClass} w-28`} />
          <label className="sr-only" htmlFor="scout-grad-to">Grad year to</label>
          <input id="scout-grad-to" type="number" inputMode="numeric" min="2000" max="2100" value={gradTo} onChange={e => setGradTo(e.target.value)} placeholder="Grad to" className={`${inputClass} w-28`} />
        </div>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by sport">
        <button
          role="tab"
          aria-selected={sport === null}
          onClick={() => setSport(null)}
          className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${sport === null ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'}`}
        >
          All sports
        </button>
        {SPORTS.map(s => (
          <button
            key={s.sport_key}
            role="tab"
            aria-selected={sport === s.sport_key}
            onClick={() => setSport(sport === s.sport_key ? null : s.sport_key)}
            className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${sport === s.sport_key ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'}`}
          >
            {s.display_name}
          </button>
        ))}
      </div>

      {state === 'loading' && <p className="text-sm text-muted" aria-busy="true">Searching…</p>}
      {state === 'unsupported' && <p className="text-sm text-tertiary">Recruiting search needs a database migration first (182).</p>}
      {state === 'error' && <p className="text-sm text-tertiary">Could not search right now.</p>}
      {state === 'ready' && athletes.length === 0 && (
        <p className="text-sm text-tertiary" data-scout-results="0">No recruitable athletes match. Athletes appear here once they open recruiting on their profile.</p>
      )}
      {state === 'ready' && athletes.length > 0 && (
        <ul className="divide-y divide-border-subtle" data-scout-results={athletes.length}>
          {athletes.map(a => (
            <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="min-w-0">
                <Link href={`/athlete/${a.id}`} className="font-medium text-primary hover:text-brand-fg">{a.name}</Link>
                <p className="text-xs text-tertiary truncate">
                  {[a.sport, a.school, gradYearLabel(a.gradYear), [a.city, a.region].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                </p>
                <p className="text-xs text-muted">{RECRUITING_STATUS_LABEL[a.recruitingStatus]}</p>
              </div>
              <ShortlistButton athleteId={a.id} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
