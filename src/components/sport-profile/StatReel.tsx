'use client';

import Link from 'next/link';
import { statTitle, seasonTitle, sportViewSearch } from '@/lib/sport-profile/view';
import ClipReel from './ClipReel';
import type { SportProfileData } from './types';
import { useClips } from './useClips';

interface Props {
  data: SportProfileData;
  profileId: string;
  season: string | null;
  /** The stat whose clips these are — or null for a period's reel. */
  stat: string | null;
  /** One period of the season's film (the period split's door). */
  period?: number | null;
  /** The kind of play chosen under the stat (a sheet event: `three_made`). */
  event?: string | null;
  basePath: string;
  showHeld: boolean;
  eventLabel: (eventKey: string | null) => string | null;
  rev: number;
}

/**
 * The clips behind a number at the career or a season: "every goal that season, in order, without leaving the page".
 * Under a stat, the kinds of play that made it are chips (twos, threes, free throws) — each its own reel.
 * A period's row opens the same reel for that period.
 */
export default function StatReel({ data, profileId, season, stat, period = null, event = null, basePath, showHeld, eventLabel, rev }: Props) {
  // The whole stat first: it is what the chips are made from, and what plays when no kind is chosen.
  const whole = useClips({ profileId, sport: data.sport, season, stat, period, showHeld, rev }, true);
  const narrowed = useClips({ profileId, sport: data.sport, season, stat, period, event, showHeld, rev }, !!event);
  const reel = event ? narrowed : whole;
  const column = stat ? data.columns.find(c => c.key === stat) : null;
  const scope = season ? seasonTitle(season) : 'career';
  const what = stat ? (column ? statTitle(column.label, column.format) : 'Clips') : `${data.period?.noun ?? 'Period'} ${period}`;
  const heading = `${what}${event ? ` · ${eventLabel(event) ?? event}` : ''} — ${scope}`;
  // The kinds of play among the stat's clips (the first page is enough to name them); one kind needs no chips.
  const kinds = stat ? [...new Set(whole.clips.map(c => c.eventKey).filter((k): k is string => !!k))] : [];
  const chip = (active: boolean) => `ea-interactive inline-flex min-h-[44px] shrink-0 items-center rounded-full border px-4 text-sm font-medium ${active ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-primary'}`;
  return (
    <div className="mb-8 border-b border-border-subtle pb-8" data-stat-reel={stat ?? `period:${period}`}>
      {kinds.length > 1 && (
        <nav aria-label="Kind of play" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 scrollbar-hide sm:mx-0 sm:px-0" data-stat-kinds="">
          <Link href={`${basePath}${sportViewSearch({ season, stat })}`} scroll={false} aria-current={!event ? 'true' : undefined} className={chip(!event)} data-stat-kind="all">All</Link>
          {kinds.map(k => (
            <Link key={k} href={`${basePath}${sportViewSearch({ season, stat, event: k })}`} scroll={false} aria-current={event === k ? 'true' : undefined} className={chip(event === k)} data-stat-kind={k}>{eventLabel(k) ?? k}</Link>
          ))}
        </nav>
      )}
      {reel.state === 'loading' && <div className="min-h-[30vh]" aria-busy="true" />}
      {reel.state === 'error' && <p className="text-secondary" role="alert">The clips could not be loaded.</p>}
      {reel.state === 'ready' && (
        <ClipReel
          key={`${season ?? ''}|${stat ?? ''}|${period ?? ''}|${event ?? ''}`}
          heading={heading}
          clips={reel.clips}
          total={reel.total}
          onLoadMore={reel.more}
          closeHref={`${basePath}${sportViewSearch({ season })}`}
          eventLabel={eventLabel}
        />
      )}
    </div>
  );
}
