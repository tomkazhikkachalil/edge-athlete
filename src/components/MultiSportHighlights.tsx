'use client';

import { useState, useEffect } from 'react';
import { getSportDefinition, getAllSports, getSportAdapter } from '@/lib/sports';
import { getSeasonDisplayName, PLACEHOLDERS } from '@/lib/config';
import { COPY } from '@/lib/copy';
import { getSportColorClasses, getNeutralColorClasses, cssClasses } from '@/lib/design-tokens';

interface HighlightTile {
  label: string;
  value: string | number | null;
}

interface MultiSportHighlightsProps {
  profileId: string;
  canEdit?: boolean;
  onEdit?: (sportKey: string, entityId?: string) => void;
}

export default function MultiSportHighlights({ profileId, canEdit = true, onEdit }: MultiSportHighlightsProps) {
  const [highlightData, setHighlightData] = useState<Record<string, HighlightTile[]>>({});
  const [loading, setLoading] = useState(true);

  // Load highlight data for all sports
  useEffect(() => {
    const loadHighlights = async () => {
      try {
        const allSports = getAllSports();
        const data: Record<string, HighlightTile[]> = {};
        
        // Load highlights for each sport (enabled sports get real data, others get placeholders)
        for (const adapter of allSports) {
          const sportDef = getSportDefinition(adapter.sportKey);
          if (adapter.isEnabled()) {
            // Enabled sports (Golf) get real data
            data[adapter.sportKey] = await adapter.getHighlights(profileId);
          } else {
            // Disabled sports get placeholder tiles with registry labels
            data[adapter.sportKey] = [
              { label: sportDef.metric_labels.tile1, value: null },
              { label: sportDef.metric_labels.tile2, value: null },
              { label: sportDef.metric_labels.tile3, value: null },
              { label: sportDef.metric_labels.tile4, value: null },
              ...(sportDef.metric_labels.tile5 ? [{ label: sportDef.metric_labels.tile5, value: null }] : []),
              ...(sportDef.metric_labels.tile6 ? [{ label: sportDef.metric_labels.tile6, value: null }] : [])
            ];
          }
        }
        
        setHighlightData(data);
      } catch (_error) {
        // Error loading sport highlights
      } finally {
        setLoading(false);
      }
    };

    if (profileId) {
      loadHighlights();
    }
  }, [profileId]);

  const handleEditSport = (sportKey: string) => {
    const adapter = getSportAdapter(sportKey as any);
    
    if (adapter.isEnabled()) {
      onEdit?.(sportKey);
    } else {
      // Show "coming soon" message using centralized copy
      // Show coming soon message
    }
  };

  const renderSportCard = (sportKey: string) => {
    const sportDef = getSportDefinition(sportKey as any);
    const adapter = getSportAdapter(sportKey as any);
    const tiles = highlightData[sportKey] || [];
    const isEnabled = adapter.isEnabled();
    
    // Get color classes from design tokens
    const colors = isEnabled
      ? getSportColorClasses(sportKey as any)
      : getNeutralColorClasses();
    
    return (
      <div
        key={sportKey}
        className={`${cssClasses.LAYOUT.CARD} relative overflow-hidden rounded-lg border-2 transition-all hover:shadow-md ${colors.cardBorder} ${colors.cardBackground}`}
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
            
            {canEdit && (
              <button
                onClick={() => handleEditSport(sportKey)}
                className={`p-1 transition-colors flex-shrink-0 ${colors.buttonSecondary} ${!isEnabled && 'cursor-not-allowed'}`}
                title={isEnabled ? `Edit ${sportDef.display_name.toLowerCase()}` : COPY.COMING_SOON.SPORT_GENERAL}
                disabled={!isEnabled}
              >
                <i className={`fas fa-edit ${cssClasses.ICONS.EDIT}`}></i>
              </button>
            )}
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
          <div className={`grid grid-cols-2 ${cssClasses.SPACING.GAP.MICRO}`}>
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

        {/* Background Pattern */}
        <div className="absolute top-0 right-0 w-16 h-16 opacity-5">
          <i className={`${sportDef.icon_id} text-4xl ${colors.iconPrimary} absolute top-2 right-2`}></i>
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-base">
        <h2 className="text-h2 text-gray-900 space-base">Sport Highlights</h2>
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

  // Show primary sports (golf + 2 most important disabled sports)
  const primarySportKeys = ['golf', 'ice_hockey', 'volleyball'];
  const hasAnyData = primarySportKeys.some(key => 
    highlightData[key]?.some(tile => tile.value !== null)
  );

  return (
    <div className="bg-white rounded-lg shadow-sm p-base">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-base">
        <h2 className="text-h2 text-gray-900">Sport Highlights</h2>
        <div className="inline-flex items-center px-3 py-1 bg-gray-50 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors cursor-default">
          <span className="text-label text-gray-900 font-bold">{getSeasonDisplayName()}</span>
          <i className="fas fa-chevron-down icon-footer text-gray-800 ml-2" aria-hidden="true"></i>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-base">
        {primarySportKeys.map(sportKey => renderSportCard(sportKey))}
      </div>

      {/* Empty State Message - only show if no enabled sports have data */}
      {!hasAnyData && (
        <div className="text-center mt-base mb-section">
          <p className="text-gray-900 text-sm font-medium">
            {PLACEHOLDERS.NO_HIGHLIGHTS}
          </p>
        </div>
      )}
    </div>
  );
}