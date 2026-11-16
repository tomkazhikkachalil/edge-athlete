'use client';

/**
 * Golf's Clips tab ("one wave", phase 3): every photo and clip of the rounds
 * this viewer may list, newest round first; a season narrows it
 * (`?view=clips&season=2026`), and each tile's caption is the door to the hole
 * it was taken on.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { golfSeasonOf, type GolfMedia } from '@/lib/sport-profile/golf-rules';
import { sportViewSearch, type SportView } from '@/lib/sport-profile/view';
import GolfMediaGrid from './GolfMediaGrid';
import type { GolfProfileData } from './types';

interface Props { profileId: string; data: GolfProfileData; view: SportView; basePath: string }
type Load = { state: 'loading' } | { state: 'error' } | { state: 'ready'; media: GolfMedia[] };

const day = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

export default function GolfClips({ profileId, data, view, basePath }: Props) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/profile/${profileId}/sport-profile?sport=golf&media=all`, { credentials: 'include' })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status));
        return (await r.json()) as { media?: GolfMedia[] };
      })
      .then(body => { if (!cancelled) setLoad({ state: 'ready', media: body.media ?? [] }); })
      .catch(() => { if (!cancelled) setLoad({ state: 'error' }); });
    return () => { cancelled = true; };
  }, [profileId]);

  const roundOf = new Map(data.rounds.map(r => [r.id, r]));
  const all = load.state === 'ready' ? load.media.filter(m => roundOf.has(m.roundId)) : [];
  const years = [...new Set(all.map(m => golfSeasonOf(roundOf.get(m.roundId)!.date)))].sort().reverse();
  const shown = view.season ? all.filter(m => golfSeasonOf(roundOf.get(m.roundId)!.date) === view.season) : all;
  const where = (m: GolfMedia) => {
    const r = roundOf.get(m.roundId)!;
    return `${m.n ? `Hole ${m.n}, ` : ''}${r.course}, ${day(r.date)}`;
  };
  const chip = (active: boolean) => `ea-interactive inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm font-medium ${active ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-primary'}`;

  return (
    <section className="space-y-4" data-sport-level="clips" data-golf-clips="">
      {load.state === 'loading' && <div className="min-h-[30vh]" aria-busy="true" />}
      {load.state === 'error' && <p className="text-secondary" role="alert">The clips could not be loaded. Check your connection and try again.</p>}
      {load.state === 'ready' && all.length === 0 && (
        <p className="text-secondary" data-golf-clips-empty="">No photos or clips yet. A photo or clip added to a hole during a shared round shows here, and on its hole.</p>
      )}
      {all.length > 0 && (
        <>
          {years.length > 1 && (
            <nav aria-label="Season" className="-mx-4 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0">
              <Link href={`${basePath}${sportViewSearch({ tab: 'clips' })}`} aria-current={!view.season ? 'true' : undefined} className={chip(!view.season)} data-golf-clips-season="all">All</Link>
              {years.map(y => (
                <Link key={y} href={`${basePath}${sportViewSearch({ tab: 'clips', season: y })}`} aria-current={view.season === y ? 'true' : undefined} className={chip(view.season === y)} data-golf-clips-season={y}>{y}</Link>
              ))}
            </nav>
          )}
          <p className="text-sm text-muted" data-golf-clips-count={shown.length}>{shown.length} {shown.length === 1 ? 'photo or clip' : 'photos and clips'}</p>
          <GolfMediaGrid
            media={shown}
            describe={where}
            caption={m => {
              const r = roundOf.get(m.roundId)!;
              const season = golfSeasonOf(r.date);
              return { text: m.n ? `Hole ${m.n} · ${r.course}` : r.course, href: `${basePath}${sportViewSearch({ season, game: `round:${r.id}`, hole: m.n })}` };
            }}
          />
        </>
      )}
    </section>
  );
}
