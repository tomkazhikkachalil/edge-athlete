'use client';

import { GOLF_LABEL } from '@/components/golf/golf-form-styles';

/**
 * Step 1 of the golf round (Oct 28 2026): the sport named, then WHEN
 * ("Playing now" goes live, "Already played" logs a finished round) and
 * WHERE (Outdoor / Indoor). Both default as the one-page form did —
 * Playing now, Outdoor (Tom: keep today's defaults). The copy, the labels
 * and the colours are the form's, moved verbatim; the e2e idioms
 * (`/already played/i`, `/outdoor/i`) still find exactly these buttons.
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
          <i className="fas fa-golf-ball mr-2 text-green-600 dark:text-green-400" aria-hidden="true"></i>
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
                ? 'bg-red-600 text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-red-300 dark:hover:border-red-700'
            }`}
          >
            <span className={`inline-block w-2 h-2 rounded-full mr-2 ${!alreadyPlayed ? 'bg-white animate-pulse' : 'bg-red-500'}`}></span>
            Playing now
          </button>
          <button
            type="button"
            onClick={() => onAlreadyPlayed(true)}
            aria-pressed={alreadyPlayed}
            className={`px-4 py-3 min-h-[44px] rounded-lg font-semibold transition-all ${
              alreadyPlayed
                ? 'bg-brand text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-border-strong'
            }`}
          >
            <i className="fas fa-flag-checkered mr-2" aria-hidden="true"></i>
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
                ? 'bg-green-600 text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-green-300 dark:hover:border-green-700'
            }`}
          >
            <i className="fas fa-tree mr-2" aria-hidden="true"></i>
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
            <i className="fas fa-warehouse mr-2" aria-hidden="true"></i>
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
