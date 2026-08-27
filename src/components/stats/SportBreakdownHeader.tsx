'use client';

/**
 * The sport layer's stat header — Tom's "short intro that can be expanded".
 *
 * Collapsed (default): sport icon + the sport's headline skill metric with
 * its provenance chip + the summary tiles — a compact strip above the media
 * grid, which stays the bigger presence. Expanding reveals the sport's full
 * professional breakdown (`children` — GolfBreakdown, StatLineBreakdown, …);
 * sports whose full breakdown hasn't landed yet simply have no children and
 * render no expander.
 */

import { useState } from 'react';
import { getSportDefinition } from '@/lib/sports/SportRegistry';
import type { SportKey } from '@/lib/sports/SportRegistry';
import type { SportSkillCard } from '@/lib/sports/server/types';
import { ProvenanceChip, TileGrid } from '../SportSkillCards';
import SportSettingsRow from '../SportSettingsRow';

interface SportBreakdownHeaderProps {
  card: SportSkillCard;
  /** Renders the expanded full breakdown; absent = no expander shown. */
  children?: React.ReactNode;
}

export default function SportBreakdownHeader({ card, children }: SportBreakdownHeaderProps) {
  const [expanded, setExpanded] = useState(false);
  const sportDef = getSportDefinition(card.sportKey as SportKey);

  return (
    <section
      aria-label={`${card.sportLabel} stats`}
      className="mb-4 bg-surface rounded-xl shadow-sm border border-border p-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-secondary flex items-center gap-2">
            <i className={sportDef.icon_id} aria-hidden="true"></i>
            {card.sportLabel}
          </h2>

          {card.headline && (
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
              <span className="text-3xl font-bold text-primary">{card.headline.value}</span>
              <span className="text-sm text-muted">
                {card.headline.label}
                {card.headline.detail ? ` ${card.headline.detail}` : ''}
              </span>
              <ProvenanceChip provenance={card.headline.provenance} />
            </div>
          )}

          {card.progress && (
            <div className="mt-2">
              <p className="text-sm font-medium text-secondary">
                {card.progress.count} of {card.progress.needed} {card.progress.label}
              </p>
              <div className="mt-1.5 h-1.5 w-56 max-w-full rounded-full bg-surface-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-brand"
                  style={{
                    width: `${Math.min(100, Math.round((card.progress.count / card.progress.needed) * 100))}%`,
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {children && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            className="ea-interactive shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-border-strong px-3 py-2 text-sm font-semibold text-secondary"
          >
            {expanded ? 'Less' : 'Full breakdown'}
            <i
              className={`fas fa-chevron-down text-xs transition-transform ${expanded ? 'rotate-180' : ''}`}
              aria-hidden="true"
            ></i>
          </button>
        )}
      </div>

      <TileGrid tiles={card.tiles} />
      <SportSettingsRow items={card.entered} className="mt-3 px-0 pb-0" />

      {expanded && children && (
        <div className="mt-4 pt-4 border-t border-border-subtle">{children}</div>
      )}
    </section>
  );
}
