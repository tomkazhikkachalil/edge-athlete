'use client';

import { GOLF_LABEL } from '@/components/golf/golf-form-styles';
import FaIcon from '@/components/FaIcon';
import { faFlagCheckered } from '@/lib/icons/fa/flag-checkered';
import { faGolfBallTee } from '@/lib/icons/fa/golf-ball-tee';
import { faTree } from '@/lib/icons/fa/tree';
import { faWarehouse } from '@/lib/icons/fa/warehouse';

/**
 * Step 1 of the golf round (Oct 28 2026): the sport named, then WHEN
 * ("Playing now" goes live, "Already played" logs a finished round) and
 * WHERE (Outdoor / Indoor). Both default as the one-page form did —
 * Playing now, Outdoor (Tom: keep today's defaults). The copy and the
 * labels are the form's, moved verbatim; the e2e idioms
 * (`/already played/i`, `/outdoor/i`) still find exactly these buttons.
 * The look (Oct 29 2026, Tom's refinement spec): purple is the ONE
 * selected colour on every step; Playing now keeps a small status dot —
 * red while it is selected (the round goes live), white when it is not.
 */
interface RoundTypeStepProps {
  alreadyPlayed: boolean;
  indoor: boolean;
  onAlreadyPlayed: (alreadyPlayed: boolean) => void;
  onIndoor: (indoor: boolean) => void;
  /** Whose round it is — the athlete a guardian composes for, else the person. */
  forName?: string | null;
}

export default function RoundTypeStep({ alreadyPlayed, indoor, onAlreadyPlayed, onIndoor, forName }: RoundTypeStepProps) {
  return (
    <div className="space-y-6" data-round-step="type">
      <div>
        <h3 className="text-lg font-semibold text-primary flex items-center">
          <FaIcon icon={faGolfBallTee} className="mr-2 text-green-600 dark:text-green-400" />
          Golf
          {forName && <span className="ml-2 text-sm font-medium text-tertiary">· for {forName}</span>}
        </h3>
      </div>

      <div>
        <label className={GOLF_LABEL}>When is this round?</label>
        {/* Stacks below sm — "Already played" + icon wraps in a ~90px
            half-column at 320px */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onAlreadyPlayed(false)}
            aria-pressed={!alreadyPlayed}
            className={`px-4 py-3 min-h-[44px] rounded-lg font-semibold transition-all ${
              !alreadyPlayed
                ? 'bg-brand text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-violet-300 dark:hover:border-violet-700'
            }`}
          >
            <span
              data-live-dot=""
              className={`inline-block w-2 h-2 rounded-full mr-2 ${!alreadyPlayed ? 'bg-red-500 animate-pulse' : 'bg-white border border-border-strong'}`}
            ></span>
            Playing now
          </button>
          <button
            type="button"
            onClick={() => onAlreadyPlayed(true)}
            aria-pressed={alreadyPlayed}
            className={`px-4 py-3 min-h-[44px] rounded-lg font-semibold transition-all ${
              alreadyPlayed
                ? 'bg-brand text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-violet-300 dark:hover:border-violet-700'
            }`}
          >
            <FaIcon icon={faFlagCheckered} className="mr-2" />
            Already played
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted">
          {alreadyPlayed
            ? 'Log a finished round — full scorecard, solo or with friends.'
            : 'Round goes LIVE — score hole by hole as you play, solo or with friends.'}
        </p>
      </div>

      <div>
        <label className={GOLF_LABEL}>Round Type</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => onIndoor(false)}
            aria-pressed={!indoor}
            className={`px-4 py-3 min-h-[44px] rounded-lg font-semibold transition-all ${
              !indoor
                ? 'bg-brand text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-violet-300 dark:hover:border-violet-700'
            }`}
          >
            <FaIcon icon={faTree} className="mr-2" />
            Outdoor
          </button>
          <button
            type="button"
            onClick={() => onIndoor(true)}
            aria-pressed={indoor}
            className={`px-4 py-3 min-h-[44px] rounded-lg font-semibold transition-all ${
              indoor
                ? 'bg-brand text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-violet-300 dark:hover:border-violet-700'
            }`}
          >
            <FaIcon icon={faWarehouse} className="mr-2" />
            Indoor
          </button>
        </div>
        {indoor && (
          <p className="mt-1.5 text-xs text-muted">Indoor rounds skip the tee and the playing conditions.</p>
        )}
      </div>
    </div>
  );
}
