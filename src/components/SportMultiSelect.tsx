'use client';

import { getAllSports, type SportKey } from '@/lib/sports/SportRegistry';
import { toggleSportSelection, MAX_SELECTED_SPORTS } from '@/lib/sports/sport-selection';

interface SportMultiSelectProps {
  selected: SportKey[];
  onChange: (keys: SportKey[]) => void;
  max?: number;
}

/**
 * Multi-select sport grid for intake + profile editing. EVERY registry sport
 * is selectable (sports on the profile, Oct 14 2026: a person who plays
 * tennis picks tennis and sees it on their profile; a disabled sport is
 * badged "Coming soon" — its stats door arrives with its adapter).
 * 'training' is a post category — it has no adapter and is never offered.
 * Selection ORDER matters: the first pick is the athlete's primary sport.
 */
export default function SportMultiSelect({
  selected,
  onChange,
  max = MAX_SELECTED_SPORTS,
}: SportMultiSelectProps) {
  const selectable = getAllSports();
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
              {!def.enabled && !isSelected && (
                <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 bg-surface-sunken text-muted text-[10px] font-semibold rounded-full">
                  Coming soon
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

      <p className="mt-3 text-xs text-muted">
        Pick up to {max}. Your first pick is your primary sport — you can change this anytime in your profile.
      </p>
    </div>
  );
}
