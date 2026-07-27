'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { getSportDefinition, getSportAdapter, getPrimarySports, type SportKey } from '@/lib/sports';
import { PLACEHOLDERS } from '@/lib/config';
import { COPY } from '@/lib/copy';
import { getSportColorClasses, getNeutralColorClasses, cssClasses } from '@/lib/design-tokens';
import YearSelect from './filters/YearSelect';

interface HighlightTile {
  label: string;
  value: string | number | null;
}

interface MultiSportHighlightsProps {
  profileId: string;
  /** When provided, enabled sport cards become buttons that invoke this
   *  (used to jump to that sport's media + open its latest post). The
   *  currently selected highlight year rides along (null = all time). */
  onSportClick?: (sportKey: SportKey, year: number | null) => void;
}

export default function MultiSportHighlights({ profileId, onSportClick }: MultiSportHighlightsProps) {
  const [highlightData, setHighlightData] = useState<Record<SportKey, HighlightTile[]>>({} as Record<SportKey, HighlightTile[]>);
  const [displaySportKeys, setDisplaySportKeys] = useState<SportKey[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [availableYears, setAvailableYears] = useState<number[]>([]);
  const [refetching, setRefetching] = useState(false);
  // Guard against out-of-order responses when the year toggles quickly
  const requestSeqRef = useRef(0);
  const lastFetchedYearRef = useRef<number | null>(null);

  const loadTiles = useCallback(
    async (sportKeys: SportKey[], year: number | null): Promise<Record<SportKey, HighlightTile[]>> => {
      const data: Record<SportKey, HighlightTile[]> = {} as Record<SportKey, HighlightTile[]>;
      await Promise.all(
        sportKeys.map(async sportKey => {
          const adapter = getSportAdapter(sportKey);
          const sportDef = getSportDefinition(sportKey);
          if (adapter.isEnabled()) {
            data[sportKey] = await adapter.getHighlights(
              profileId,
              year !== null ? String(year) : undefined
            );
          } else {
            data[sportKey] = [
              { label: sportDef.metric_labels.tile1, value: null },
              { label: sportDef.metric_labels.tile2, value: null },
              { label: sportDef.metric_labels.tile3, value: null },
              { label: sportDef.metric_labels.tile4, value: null },
              ...(sportDef.metric_labels.tile5 ? [{ label: sportDef.metric_labels.tile5, value: null }] : []),
              ...(sportDef.metric_labels.tile6 ? [{ label: sportDef.metric_labels.tile6, value: null }] : [])
            ];
          }
        })
      );
      return data;
    },
    [profileId]
  );

  // Initial load: active sports, all-time tiles, and available years
  useEffect(() => {
    const loadHighlights = async () => {
      try {
        // Which sports does this athlete actually participate in? Show those
        // instead of every enabled sport (which would be mostly-empty cards).
        let sportKeys: SportKey[] = [];
        try {
          const res = await fetch(`/api/profile/${profileId}/active-sports`, {
            credentials: 'include',
          });
          if (res.ok) {
            const json = await res.json();
            sportKeys = (json.sportKeys || []) as SportKey[];
          }
        } catch {
          // fall through to fallback below
        }

        // Fallback for athletes with no activity yet: a few enabled sports as
        // prompts so the profile isn't blank and encourages a first post.
        if (sportKeys.length === 0) {
          sportKeys = getPrimarySports(3).slice(0, 3).map(s => s.sport_key);
        }

        setDisplaySportKeys(sportKeys);

        // Tiles (all-time) + years with data, unioned across sports
        const [data, yearsArrays] = await Promise.all([
          loadTiles(sportKeys, null),
          Promise.all(
            sportKeys.map(sportKey => {
              const adapter = getSportAdapter(sportKey);
              return adapter.isEnabled()
                ? adapter.getHighlightYears(profileId)
                : Promise.resolve([]);
            })
          ),
        ]);

        setHighlightData(data);
        setAvailableYears(
          Array.from(new Set(yearsArrays.flat())).sort((a, b) => b - a)
        );
      } catch (e) {
        console.error('Failed to load sport highlights:', e);
      } finally {
        setLoading(false);
      }
    };

    if (profileId) {
      loadHighlights();
    }
  }, [profileId, loadTiles]);

  // Refetch tiles when the year selection changes (skips the initial
  // all-time load — lastFetchedYearRef starts at null)
  useEffect(() => {
    if (displaySportKeys.length === 0) return;
    if (selectedYear === lastFetchedYearRef.current) return;
    lastFetchedYearRef.current = selectedYear;

    const seq = ++requestSeqRef.current;
    setRefetching(true);
    loadTiles(displaySportKeys, selectedYear)
      .then(data => {
        if (seq === requestSeqRef.current) setHighlightData(data);
      })
      .catch(e => console.error('Failed to load sport highlights:', e))
      .finally(() => {
        if (seq === requestSeqRef.current) setRefetching(false);
      });
  }, [selectedYear, displaySportKeys, loadTiles]);

  const renderSportCard = (sportKey: SportKey) => {
    const sportDef = getSportDefinition(sportKey);
    const adapter = getSportAdapter(sportKey);
    const tiles = highlightData[sportKey] || [];
    const isEnabled = adapter.isEnabled();
    
    // Get color classes from design tokens
    const colors = isEnabled
      ? getSportColorClasses(sportKey)
      : getNeutralColorClasses();

    // A real <button> when clickable (keyboard + touch for free); coming-soon
    // sports and prop-less usage stay a plain div exactly as before.
    const clickable = isEnabled && !!onSportClick;
    const Card = clickable ? ('button' as const) : ('div' as const);

    return (
      <Card
        key={sportKey}
        {...(clickable
          ? {
              type: 'button' as const,
              onClick: () => onSportClick!(sportKey, selectedYear),
              'aria-label': `View ${sportDef.display_name} posts`,
            }
          : {})}
        className={`${cssClasses.LAYOUT.CARD} relative overflow-hidden rounded-lg border-2 transition-all hover:shadow-md ${colors.cardBorder} ${colors.cardBackground} ${
          clickable
            ? 'w-full text-left cursor-pointer hover:shadow-lg hover:-translate-y-0.5 focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2'
            : ''
        }`}
      >
        {/* Header */}
        <div className={cssClasses.LAYOUT.CARD_HEADER}>
          <div className="season-card-header-top flex items-center justify-between">
            <div className={`flex items-center ${cssClasses.ICONS.GAP} flex-1 min-w-0`}>
              <div className={`${cssClasses.ICONS.HEADER} rounded-full bg-white shadow-sm flex-shrink-0`}>
                <i className={`${sportDef.icon_id} ${colors.iconPrimary}`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className={`${cssClasses.TYPOGRAPHY.H3} text-gray-900 truncate`}>{sportDef.display_name}</h3>
              </div>
            </div>
          </div>

          {/* Status indicator for disabled sports */}
          {!isEnabled && (
            <div className="season-card-chips">
              <div className="season-chip bg-gray-100 text-gray-900 font-semibold border border-gray-300">
                {COPY.COMING_SOON.SPORT_GENERAL}
              </div>
            </div>
          )}
        </div>

        {/* Stats Grid - First 4 tiles in 2x2 grid */}
        <div className={cssClasses.LAYOUT.CARD_STATS}>
          <div className="grid grid-cols-2 gap-4">
            {tiles.slice(0, 4).map((tile, index) => (
              <div key={index} className={cssClasses.LAYOUT.STAT_TILE}>
                <div className={cssClasses.LAYOUT.STAT_VALUE}>
                  {tile.value || '—'}
                </div>
                <div className={cssClasses.LAYOUT.STAT_LABEL}>
                  {tile.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Decorative Footer */}
        <div className={cssClasses.LAYOUT.CARD_FOOTER}>
          <div className={`flex items-center justify-center ${cssClasses.SPACING.GAP.MICRO} opacity-40`}>
            <i className={`${sportDef.icon_id} ${cssClasses.ICONS.FOOTER} ${colors.iconPrimary}`}></i>
            <i className={`fas fa-trophy ${cssClasses.ICONS.FOOTER} text-yellow-500`}></i>
            <i className={`fas fa-medal ${cssClasses.ICONS.FOOTER} text-gray-800`}></i>
            <i className={`fas fa-star ${cssClasses.ICONS.FOOTER} text-yellow-400`}></i>
          </div>
        </div>

        {/* Background Pattern — decorative; must not eat clicks/cursor */}
        <div className="absolute top-0 right-0 w-16 h-16 opacity-5 pointer-events-none" aria-hidden="true">
          <i className={`${sportDef.icon_id} text-4xl ${colors.iconPrimary} absolute top-2 right-2`}></i>
        </div>
      </Card>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-6 sm:p-8">
        <h2 className="text-h2 text-gray-900 mb-6">Sport Highlights</h2>
        <div className="grid md:grid-cols-3 gap-base">
          {[1, 2, 3].map(i => (
            <div key={i} className="season-card bg-gray-50 rounded-lg border-2 border-gray-200 animate-pulse">
              <div className="h-64"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Show the athlete's active sports (loaded above); registry order.
  const primarySportKeys: SportKey[] = displaySportKeys;
  const hasAnyData = primarySportKeys.some(key =>
    highlightData[key]?.some(tile => tile.value !== null)
  );

  return (
    <div className="bg-white rounded-lg shadow-sm p-6 sm:p-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-6">
        <h2 className="text-h2 text-gray-900">Sport Highlights</h2>
        {/* Working year selector (replaces the old hardcoded season chip);
            renders nothing until the athlete has dated stats */}
        <YearSelect
          years={availableYears}
          value={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      <div className={`grid md:grid-cols-3 gap-base transition-opacity ${refetching ? 'opacity-60 pointer-events-none' : ''}`}>
        {primarySportKeys.map(sportKey => renderSportCard(sportKey))}
      </div>

      {/* Empty State Message - only show if no enabled sports have data */}
      {!hasAnyData && (
        <div className="text-center mt-base mb-section">
          <p className="text-gray-900 text-sm font-medium">
            {selectedYear !== null
              ? `No stats recorded in ${selectedYear}.`
              : PLACEHOLDERS.NO_HIGHLIGHTS}
          </p>
        </div>
      )}
    </div>
  );
}