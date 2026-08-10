'use client';

import { getPrimarySports, getDisabledSports, type SportKey } from '@/lib/sports/SportRegistry';
import { toggleSportSelection, MAX_SELECTED_SPORTS } from '@/lib/sports/sport-selection';

interface SportMultiSelectProps {
  selected: SportKey[];
  onChange: (keys: SportKey[]) => void;
  max?: number;
}

/**
 * Multi-select sport grid for intake + profile editing. Selectable sports
 * come from getPrimarySports() (enabled sports; 'training' is a post
 * category — it has no adapter and must never be offered as a sport).
 * Selection ORDER matters: the first pick is the athlete's primary sport.
 * Disabled registry sports render locked as roadmap honesty.
 */
export default function SportMultiSelect({
  selected,
  onChange,
  max = MAX_SELECTED_SPORTS,
}: SportMultiSelectProps) {
  const selectable = getPrimarySports();
  const comingSoon = getDisabledSports();
  const atCap = selected.length >= max;

  return (
    <div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {selectable.map(def => {
          const isSelected = selected.includes(def.sport_key);
          const isPrimary = selected[0] === def.sport_key;
          const blocked = !isSelected && atCap;
          return (
            <button
              key={def.sport_key}
              type="button"
              onClick={() => onChange(toggleSportSelection(selected, def.sport_key, max))}
              disabled={blocked}
              aria-pressed={isSelected}
              className={`relative flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all min-h-[88px] ${
                isSelected
                  ? 'border-brand bg-brand-soft'
                  : blocked
                  ? 'border-border bg-surface-muted opacity-50 cursor-not-allowed'
                  : 'border-border bg-surface hover:border-violet-300 hover:bg-brand-soft/50'
              }`}
            >
              {isPrimary && (
                <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 bg-brand text-white text-[10px] font-bold rounded-full">
                  PRIMARY
                </span>
              )}
              {isSelected && !isPrimary && (
                <span className="absolute top-1.5 right-1.5 w-5 h-5 bg-brand text-white rounded-full flex items-center justify-center">
                  <i className="fas fa-check text-[10px]"></i>
                </span>
              )}
              <i className={`${def.icon_id} text-2xl ${isSelected ? 'text-brand-fg' : 'text-muted'}`}></i>
              <span className={`text-sm font-semibold ${isSelected ? 'text-violet-900 dark:text-violet-200' : 'text-primary'}`}>
                {def.display_name}
              </span>
            </button>
          );
        })}
      </div>

      {comingSoon.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-semibold text-muted mb-2">Coming soon</p>
          <div className="flex flex-wrap gap-2">
            {comingSoon.map(def => (
              <span
                key={def.sport_key}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-sunken text-muted text-xs font-medium rounded-full"
              >
                <i className="fas fa-lock text-[10px]"></i>
                {def.display_name}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="mt-3 text-xs text-muted">
        Pick up to {max}. Your first pick is your primary sport — you can change this anytime in your profile.
      </p>
    </div>
  );
}
