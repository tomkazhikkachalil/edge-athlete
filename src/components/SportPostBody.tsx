// SportPostBody — the sport dispatch seam for feed post bodies.
//
// PostCard renders this instead of inlining sport-specific UI. Each sport's
// body lives in its own component (e.g. golf/GolfRoundCard); adding a sport
// means adding a case here + a component, with zero edits to PostCard.
// See docs/MULTI_SPORT_ROADMAP.md ("Feed rendering" seam).
import GolfRoundCard from './golf/GolfRoundCard';
import GolfStatsSummaryCard from './golf/GolfStatsSummaryCard';
import StatLineCard from './StatLineCard';
import StatHighlightCard from './StatHighlightCard';
import { isStatLineData } from '@/lib/sports/stat-schemas';
import type { GolfRound } from '@/types/golf';

interface SportPostBodyProps {
  sportKey: string | null | undefined;
  golfRound?: GolfRound | null;
  statsData?: Record<string, unknown> | null;
  /** A post with media leads with MediaStatStrip over the image; one without
   *  has nothing else to carry it, so it gets the hero-stat treatment. */
  hasMedia?: boolean;
  groupScorecard?: Record<string, unknown> | null;
  viewerId?: string | null;
  /** Post author — the single player on a solo golf round. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  author?: any;
  /** Opens the full scorecard from the golf card. */
  onExpandScorecard?: () => void;
}

export default function SportPostBody({
  sportKey,
  golfRound,
  statsData,
  hasMedia = false,
  groupScorecard,
  viewerId,
  author,
  onExpandScorecard,
}: SportPostBodyProps) {
  const highlight = (
    <StatHighlightCard
      sportKey={sportKey}
      statsData={statsData}
      golfRound={golfRound}
      groupScorecard={groupScorecard}
      viewerId={viewerId}
      author={author}
      onExpand={onExpandScorecard}
    />
  );

  // GOLF gets the complete card whether or not there is a photo: the course,
  // the score and WHO PLAYED are the post, and the old summary rendered them
  // as 12px label:value pairs. The solo scorecard body still follows it.
  if (sportKey === 'golf') {
    return (
      <>
        {golfRound && <GolfRoundCard round={golfRound} />}
        {highlight}
      </>
    );
  }

  // Stat-line sports: only without media, since a photo post already leads
  // with MediaStatStrip over the image.
  if (!hasMedia && isStatLineData(statsData)) return highlight;

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
