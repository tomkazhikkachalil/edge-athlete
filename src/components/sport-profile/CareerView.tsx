'use client';

import Link from 'next/link';
import { Trophy } from 'lucide-react';
import RivalsPanel from '@/components/play/RivalsPanel';
import SectionEmptyState from '@/components/SectionEmptyState';
import SeasonRollups from '@/components/stats/SeasonRollups';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { seasonTitle, sportViewSearch } from '@/lib/sport-profile/view';
import StatTable from './StatTable';
import Tiles from './Tiles';
import type { SportProfileData } from './types';

interface Props {
  profileId: string;
  data: SportProfileData;
  /** The sport profile's own path (no query). */
  basePath: string;
  sportLabel: string;
}

/** Level 1: the career — its tiles, and one row per season. A season is the door to level 2. */
export default function CareerView({ profileId, data, basePath, sportLabel }: Props) {
  if (data.seasons.length === 0) {
    return (
      <SectionEmptyState
        icon={Trophy}
        title={`No ${sportLabel.toLowerCase()} games yet`}
        body="This fills in on its own: every game a club or league tags, and every game posted, adds its stats and its clips here."
      />
    );
  }
  // A best (a pace, a race time) opens the game it was set in — at its own season.
  const bestDoor = (gameKey: string | undefined): string | null => {
    const g = gameKey ? data.games.find(x => x.key === gameKey) : null;
    return g ? `${basePath}${sportViewSearch({ season: g.season ?? 'undated', game: g.key })}` : null;
  };
  return (
    <section className="space-y-6" data-sport-level="career">
      <Tiles tiles={data.career.tiles} />
      <div>
        <h2 className="mb-3 text-lg font-bold text-primary">Career</h2>
        {!data.sums && <p className="mb-3 text-sm text-muted" data-sport-no-sums="">A race does not add up as a whole: distance and time are totals, a pace or a race time is the best of the season — tap it to open the race it was set in.</p>}
        <StatTable
          caption={`${sportLabel} career, by season`}
          leadLabel="Season"
          countLabel="GP"
          columns={data.columns}
          rows={data.seasons.map(s => ({
            id: s.key,
            lead: (
              <Link href={`${basePath}${sportViewSearch({ season: s.key })}`} className="ea-interactive rounded underline decoration-border underline-offset-4" data-season-link={s.key}>
                {seasonTitle(s.key)}
              </Link>
            ),
            count: s.games,
            stats: s.totals,
            // A number is a door: a best opens the game it was set in; a number with clips behind it opens that stat, that season, as a reel.
            door: (k: string) => bestDoor(s.bestIn[k]) ?? ((s.clips[k] ?? 0) > 0 ? `${basePath}${sportViewSearch({ season: s.key, stat: k })}` : null),
          }))}
          foot={{ id: 'career', lead: 'Career', count: data.career.games, stats: data.career.totals, door: k => bestDoor(data.career.bestIn[k]) ?? ((data.career.clips[k] ?? 0) > 0 ? `${basePath}${sportViewSearch({ stat: k })}` : null) }}
        />
      </div>
      {/* Head-to-head in this sport (Play, 244) — moved here from the Sports tab's layer; the athlete chooses what shows. */}
      <RivalsPanel profileId={profileId} sportKey={data.sport} />
      {/* The trend of the headline number and the career bests, from the performance record (the rollups' own reader). */}
      {getStatSchema(data.sport) && <SeasonRollups profileId={profileId} sportKey={data.sport} heroLabel={getStatSchema(data.sport)!.heroStat.label} mode="extras" />}
    </section>
  );
}
