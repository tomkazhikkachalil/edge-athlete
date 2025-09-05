'use client';

// No useState needed in this component
import type { SeasonHighlight, AthleteBadge } from '@/lib/supabase';
import { 
  getSeasonDisplayName,
  PLACEHOLDERS
} from '@/lib/config';
import { getSportConfig, getDisplaySports } from '@/lib/config/sports-metrics';
import { formatLeagueTags } from '@/lib/config/league-config';
import { formatScore } from '@/lib/formatters';

interface SeasonHighlightsProps {
  highlights: SeasonHighlight[];
  badges: AthleteBadge[];
  onEdit?: (sport: string, data?: SeasonHighlight) => void;
  canEdit?: boolean;
}

// Get sports configuration from centralized source
const SPORTS_CONFIG = getDisplaySports();

export default function SeasonHighlights({ highlights, badges, onEdit, canEdit = true }: SeasonHighlightsProps) {
  // Active season is now managed centrally
  // Uncomment if needed for season-specific display
  // const currentSeason = getActiveSeason();

  // Check if all season highlight cards are completely empty
  const areAllCardsEmpty = () => {
    // Check each sport to see if it has any meaningful data
    return SPORTS_CONFIG.every(sport => {
      const highlight = highlights.find(h => h.sport_key === sport.key);
      
      // A card is considered empty if:
      // - No highlight record exists, OR
      // - All metric fields and rating are empty/null
      if (!highlight) return true;
      
      const hasMetricA = highlight.metric_a && highlight.metric_a.trim() !== '';
      const hasMetricB = highlight.metric_b && highlight.metric_b.trim() !== '';
      const hasMetricC = highlight.metric_c && highlight.metric_c.trim() !== '';
      const hasRating = highlight.rating !== null && highlight.rating !== undefined;
      
      return !hasMetricA && !hasMetricB && !hasMetricC && !hasRating;
    });
  };


  const getLeagueChips = (sportKey: string, highlight?: SeasonHighlight) => {
    // First try to get league tags from the highlight data
    if (highlight?.league_tags && highlight.league_tags.length > 0) {
      return formatLeagueTags(highlight.league_tags);
    }
    
    // Fallback: Get league info from badges that match this sport
    const sportBadges = badges.filter(badge => 
      badge.label.toLowerCase().includes(sportKey.toLowerCase()) ||
      badge.label.toLowerCase().includes('league') ||
      badge.label.toLowerCase().includes('championship')
    );
    
    const badgeLabels = sportBadges.slice(0, 2).map(badge => badge.label);
    return formatLeagueTags(badgeLabels);
  };

  const renderStatGrid = (sportKey: string, highlight?: SeasonHighlight) => {
    const sportConfig = getSportConfig(sportKey);
    const metrics = sportConfig.metrics;
    
    const stats = [
      { label: metrics.a, value: highlight?.metric_a || '—' },
      { label: metrics.b, value: highlight?.metric_b || '—' },
      { label: metrics.c, value: highlight?.metric_c || '—' },
      { label: metrics.rating, value: highlight?.rating !== undefined && highlight?.rating !== null ? `${formatScore(highlight.rating)}/100` : '—' }
    ];

    return (
      <div className="grid grid-cols-2 gap-3">
        {stats.map((stat, index) => (
          <div key={index} className="stat-tile">
            <div className="stat-value">
              {stat.value}
            </div>
            <div className="stat-label">
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderSportCard = (sport: typeof SPORTS_CONFIG[0]) => {
    const highlight = highlights.find(h => h.sport_key === sport.key);
    const leagueChips = getLeagueChips(sport.key, highlight);

    return (
      <div
        key={sport.key}
        className={`season-card relative overflow-hidden rounded-lg border-2 ${sport.borderColor} ${sport.bgColor} transition-all hover:shadow-md`}
      >
        {/* Header */}
        <div className="season-card-header">
          {/* Top row: Icon + Title + Edit Button */}
          <div className="season-card-header-top flex items-center justify-between">
            <div className="flex items-center icon-gap flex-1 min-w-0">
              <div className="icon-header rounded-full bg-white shadow-sm flex-shrink-0">
                <i className={`${sport.icon} ${sport.color}`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="text-h3 text-gray-900 truncate">{sport.displayName}</h3>
              </div>
            </div>
            {canEdit && (
              <button
                onClick={() => onEdit?.(sport.key, highlight)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                title="Edit season highlights"
              >
                <i className="fas fa-edit icon-edit"></i>
              </button>
            )}
          </div>

          {/* League Chips Row */}
          <div className="season-card-chips">
            {leagueChips.map((chip, index) => (
              <div
                key={index}
                className={`season-chip ${chip.styles.bgColor} ${chip.styles.color} border ${chip.styles.borderColor}`}
              >
                {chip.styles.text}
              </div>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="season-card-stats">
          {renderStatGrid(sport.key, highlight)}
        </div>

        {/* Decorative Footer */}
        <div className="season-card-footer">
          <div className="flex items-center justify-center gap-micro opacity-30">
            <i className={`${sport.icon} icon-footer ${sport.color}`}></i>
            <i className="fas fa-trophy icon-footer text-yellow-500"></i>
            <i className="fas fa-medal icon-footer text-gray-400"></i>
            <i className="fas fa-star icon-footer text-yellow-400"></i>
          </div>
        </div>

        {/* Background Pattern */}
        <div className="absolute top-0 right-0 w-16 h-16 opacity-5">
          <i className={`${sport.icon} text-4xl ${sport.color} absolute top-2 right-2`}></i>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-white rounded-lg shadow-sm p-base">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-base">
        <h2 className="text-h2 text-gray-900">Season Highlights</h2>
        <div className="inline-flex items-center px-3 py-1 bg-gray-50 rounded-md border border-gray-200 hover:bg-gray-100 transition-colors cursor-default">
          <span className="text-label text-gray-700 font-medium">{getSeasonDisplayName()}</span>
          <i className="fas fa-chevron-down icon-footer text-gray-400 ml-2" aria-hidden="true"></i>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-base">
        {SPORTS_CONFIG.map(sport => renderSportCard(sport))}
      </div>

      {/* Empty State Message - only show when ALL cards are empty */}
      {areAllCardsEmpty() && (
        <div className="text-center mt-base mb-section">
          <p className="text-gray-500 text-sm">
            {PLACEHOLDERS.NO_HIGHLIGHTS}
          </p>
        </div>
      )}
    </div>
  );
}