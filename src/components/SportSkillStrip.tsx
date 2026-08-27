'use client';

/**
 * The profile body's compact per-sport strip — one slim row per sport
 * (registry icon + headline metric + provenance mini-icon, or the n-of-N
 * progress line for pre-metric sports), each row tapping into the Stats
 * hub's sport layer. Replaced the full SportSkillCards on the profile body
 * (Stats Hub round): the profile stays clean, the hub is the home for
 * everything performance-related. Keeps `id="sports"` — specs and anchors
 * (`section:not(#sports)`) rely on it.
 */

import { getSportDefinition } from '@/lib/sports/SportRegistry';
import type { SportSkillCard } from '@/lib/sports/server/types';

interface SportSkillStripProps {
  cards: SportSkillCard[];
  isOwner: boolean;
  /** Opens the Stats hub on this sport's layer. */
  onOpenSport: (sportKey: string) => void;
  /** Owner-only add-affordance when there is nothing to show. */
  onAddDetails?: () => void;
}

const PROVENANCE_TITLE = {
  tracked: 'Calculated from logged activity on Edge Athlete',
  entered: 'Entered by the athlete — not verified',
} as const;

export default function SportSkillStrip({
  cards,
  isOwner,
  onOpenSport,
  onAddDetails,
}: SportSkillStripProps) {
  if (cards.length === 0) {
    if (!isOwner || !onAddDetails) return null;
    return (
      <section id="sports" aria-label="Sports">
        <button
          type="button"
          onClick={onAddDetails}
          className="ea-interactive w-full text-left bg-surface rounded-xl shadow-sm border border-dashed border-border px-4 py-3"
        >
          <span className="text-sm font-semibold text-secondary flex items-center gap-2">
            <i className="fas fa-medal" aria-hidden="true"></i>
            Add your competitive details
            <i className="fas fa-chevron-right text-xs text-faint ml-auto" aria-hidden="true"></i>
          </span>
        </button>
      </section>
    );
  }

  return (
    <section id="sports" aria-label="Sports">
      <div className="bg-surface rounded-xl shadow-sm border border-border divide-y divide-border-subtle overflow-hidden">
        {cards.map(card => {
          const sportDef = getSportDefinition(card.sportKey);
          return (
            <button
              key={card.sportKey}
              type="button"
              onClick={() => onOpenSport(card.sportKey)}
              className="ea-interactive w-full flex items-center gap-3 px-4 py-3 text-left min-h-[48px]"
              aria-label={`${card.sportLabel} stats`}
            >
              <i className={`${sportDef.icon_id} text-brand-fg-strong w-5 text-center shrink-0`} aria-hidden="true"></i>
              <span className="text-sm font-semibold text-primary shrink-0">{card.sportLabel}</span>
              <span className="ml-auto flex items-baseline gap-1.5 min-w-0">
                {card.headline ? (
                  <>
                    <span className="text-base font-bold text-primary tabular-nums">
                      {card.headline.value}
                    </span>
                    <span className="text-xs text-muted truncate">{card.headline.label}</span>
                    <i
                      className={`fas ${
                        card.headline.provenance === 'tracked'
                          ? 'fa-circle-check text-brand-fg'
                          : 'fa-user-pen text-muted'
                      } text-[10px]`}
                      title={PROVENANCE_TITLE[card.headline.provenance]}
                      aria-hidden="true"
                    ></i>
                  </>
                ) : card.progress ? (
                  <span className="text-xs text-muted">
                    {card.progress.count} of {card.progress.needed} {card.progress.label}
                  </span>
                ) : (
                  <span className="text-xs text-muted">View stats</span>
                )}
                <i className="fas fa-chevron-right text-xs text-faint shrink-0" aria-hidden="true"></i>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
