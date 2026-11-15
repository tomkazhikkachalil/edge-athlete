'use client';

import { seasonTitle, sportViewSearch } from '@/lib/sport-profile/view';
import ClipReel from './ClipReel';
import type { SportProfileData } from './types';
import { useClips } from './useClips';

interface Props {
  data: SportProfileData;
  profileId: string;
  season: string | null;
  stat: string;
  basePath: string;
  showHeld: boolean;
  eventLabel: (eventKey: string | null) => string | null;
  rev: number;
}

/** The clips behind a number at the career or a season: "every goal that season, in order, without leaving the page". */
export default function StatReel({ data, profileId, season, stat, basePath, showHeld, eventLabel, rev }: Props) {
  const reel = useClips({ profileId, sport: data.sport, season, stat, showHeld, rev }, true);
  const column = data.columns.find(c => c.key === stat);
  const heading = `${column?.label ?? 'Clips'} — ${season ? seasonTitle(season) : 'career'}`;
  return (
    <div className="mb-8 border-b border-border-subtle pb-8" data-stat-reel={stat}>
      {reel.state === 'loading' && <div className="min-h-[30vh]" aria-busy="true" />}
      {reel.state === 'error' && <p className="text-secondary" role="alert">The clips could not be loaded.</p>}
      {reel.state === 'ready' && (
        <ClipReel
          key={`${season ?? ''}|${stat}`}
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
