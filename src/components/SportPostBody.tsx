// SportPostBody — the sport dispatch seam for feed post bodies.
//
// PostCard renders this instead of inlining sport-specific UI. Each sport's
// body lives in its own component (e.g. golf/GolfRoundCard); adding a sport
// means adding a case here + a component, with zero edits to PostCard.
// See docs/MULTI_SPORT_ROADMAP.md ("Feed rendering" seam).
'use client';

import { useState } from 'react';
import GolfRoundCard from './golf/GolfRoundCard';
import StatLineCard from './StatLineCard';
import StatHighlightCard from './StatHighlightCard';
import { isStatLineData } from '@/lib/sports/stat-schemas';
import { buildStatHighlights } from '@/lib/sports/post-stat-highlights';
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
  // Solo rounds disclose their scorecard inline (shared rounds open a modal
  // owned by PostCard instead). Unconditional: hooks can't sit behind the
  // sport dispatch below.
  const [scorecardExpanded, setScorecardExpanded] = useState(false);

  // GOLF leads with ONE card — the highlight (course, to-par hero, who
  // played). The classic GolfRoundCard (hole tables, conditions) used to
  // stack under it, repeating course/score/to-par on every post; now it is
  // the card's expanded state instead, behind "View full scorecard".
  if (sportKey === 'golf') {
    // Pure and cheap — ask the card's own builder whether it will render
    // rather than duplicating its rules here.
    const highlights = buildStatHighlights({
      sportKey,
      statsData,
      golfRound,
      groupScorecard,
      viewerId,
      author,
    });

    // A score-less round gives the highlight card nothing to lead with; the
    // classic round card is the whole body, exactly as before.
    if (!highlights) {
      return golfRound ? <GolfRoundCard round={golfRound} /> : null;
    }

    const soloExpandable = !groupScorecard && !!golfRound;
    return (
      <>
        <StatHighlightCard
          sportKey={sportKey}
          statsData={statsData}
          golfRound={golfRound}
          groupScorecard={groupScorecard}
          viewerId={viewerId}
          author={author}
          onExpand={
            groupScorecard
              ? onExpandScorecard
              : soloExpandable
                ? () => setScorecardExpanded(v => !v)
                : undefined
          }
          expanded={soloExpandable ? scorecardExpanded : undefined}
        />
        {soloExpandable && scorecardExpanded && golfRound && (
          <GolfRoundCard round={golfRound} defaultOpenScorecard />
        )}
      </>
    );
  }

  // Stat-line sports: hero treatment only without media, since a photo post
  // already leads with MediaStatStrip over the image.
  if (!hasMedia && isStatLineData(statsData)) {
    return (
      <StatHighlightCard
        sportKey={sportKey}
        statsData={statsData}
        golfRound={golfRound}
        groupScorecard={groupScorecard}
        viewerId={viewerId}
        author={author}
      />
    );
  }

  // Stat-line sports with media — schema-driven card below the photo.
  if (isStatLineData(statsData)) {
    return <StatLineCard line={statsData} />;
  }
  return null;
}
