// SportPostBody — the sport dispatch seam for feed post bodies.
//
// PostCard renders this instead of inlining sport-specific UI. Each sport's
// body lives in its own component (e.g. golf/GolfRoundCard); adding a sport
// means adding a case here + a component, with zero edits to PostCard.
// See docs/MULTI_SPORT_ROADMAP.md ("Feed rendering" seam).
import GolfRoundCard from './golf/GolfRoundCard';
import GolfStatsSummaryCard from './golf/GolfStatsSummaryCard';
import StatLineCard from './StatLineCard';
import { isStatLineData } from '@/lib/sports/stat-schemas';
import type { GolfRound } from '@/types/golf';

interface SportPostBodyProps {
  sportKey: string | null | undefined;
  golfRound?: GolfRound | null;
  statsData?: Record<string, unknown> | null;
}

export default function SportPostBody({ sportKey, golfRound, statsData }: SportPostBodyProps) {
  switch (sportKey) {
    case 'golf':
      return (
        <>
          {golfRound && <GolfRoundCard round={golfRound} />}
          {statsData && <GolfStatsSummaryCard statsData={statsData} />}
        </>
      );
    default:
      // Stat-line sports (ice hockey, volleyball, …) — schema-driven card
      if (isStatLineData(statsData)) {
        return <StatLineCard line={statsData} />;
      }
      return null;
  }
}
