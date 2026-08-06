'use client';

/**
 * The athlete's declared details for one sport, rendered as a compact row
 * beneath that sport's stat tiles.
 *
 * Purely presentational and sport-agnostic — it receives already-formatted
 * label/value pairs from `settingsToDisplayItems`, so selects arrive as their
 * option label ("Point Guard", not "PG") and nothing here knows about any
 * particular sport.
 *
 * Styled like `.stat-label` but deliberately NOT like `.stat-value`: these are
 * preferences the athlete declared, not measurements the app computed.
 * Rendering them as stat tiles would imply they were measured and would break
 * the card's fixed 2x2 grid.
 */

import type { SettingsDisplayItem } from '@/lib/sports/settings-schemas';

interface SportSettingsRowProps {
  items: SettingsDisplayItem[];
  className?: string;
}

export default function SportSettingsRow({ items, className = '' }: SportSettingsRowProps) {
  // No items -> no wrapper, no border, no heading. Onboarding writes an empty
  // settings row for every declared sport, so this is the common case and it
  // must leave no trace on the card.
  if (items.length === 0) return null;

  return (
    <div className={`border-t border-border/60 px-4 py-2 ${className}`}>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {items.map(item => (
          <div key={item.key} className="flex items-baseline gap-1 min-w-0">
            <span className="text-[0.7rem] uppercase tracking-wide text-muted shrink-0">
              {item.label}
            </span>
            <span className="text-xs font-semibold text-primary truncate">
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
