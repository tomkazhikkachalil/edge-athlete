'use client';

// No useState needed in this component
import type { SeasonHighlight, AthleteBadge } from '@/lib/supabase';
import { 
  getSeasonDisplayName,
  PLACEHOLDERS,
  getSportName
} from '@/lib/config';

interface SeasonHighlightsProps {
  highlights: SeasonHighlight[];
  badges: AthleteBadge[];
  onEdit?: (sport: string, data?: SeasonHighlight) => void;
  canEdit?: boolean;
}

interface SportConfig {
  key: string;
  title: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}

// Dynamic sports configuration using centralized data
const SPORTS_CONFIG: SportConfig[] = [
  {
    key: 'ice_hockey',
    title: getSportName('ice_hockey'),
    icon: 'fas fa-hockey-puck',
    color: 'text-sky-500',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200'
  },
  {
    key: 'volleyball',
    title: getSportName('volleyball'), 
    icon: 'fas fa-volleyball-ball',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200'
  },
  {
    key: 'track_field',
    title: getSportName('track_field'),
    icon: 'fas fa-running',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200'
  }
];

export default function SeasonHighlights({ highlights, badges, onEdit, canEdit = true }: SeasonHighlightsProps) {
  // Active season is now managed centrally
  // Uncomment if needed for season-specific display
  // const currentSeason = getActiveSeason();

  const getLeagueChips = (sportKey: string): string[] => {
    // Get league info from badges that match this sport
    const sportBadges = badges.filter(badge => 
      badge.label.toLowerCase().includes(sportKey.toLowerCase()) ||
      badge.label.toLowerCase().includes('league') ||
      badge.label.toLowerCase().includes('championship')
    );
    
    // Always return exactly 2 chips for consistent layout
    const chip1 = sportBadges[0]?.label || '—';
    const chip2 = sportBadges[1]?.label || '—';
    
    return [chip1, chip2];
  };

  const renderStatGrid = (highlight?: SeasonHighlight) => {
    const stats = [
      { label: 'Metric A', value: highlight?.metric_a || '—' },
      { label: 'Metric B', value: highlight?.metric_b || '—' },
      { label: 'Metric C', value: highlight?.metric_c || '—' },
      { label: 'Rating', value: highlight?.rating ? `${highlight.rating}/100` : '—' }
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

  const renderSportCard = (sport: SportConfig) => {
    const highlight = highlights.find(h => h.sport_key === sport.key);
    const leagueChips = getLeagueChips(sport.key);

    return (
      <div
        key={sport.key}
        className={`season-card relative overflow-hidden rounded-lg border-2 ${sport.borderColor} ${sport.bgColor} transition-all hover:shadow-md`}
      >
        {/* Header */}
        <div className="season-card-header">
          {/* Top row: Icon + Title + Edit Button */}
          <div className="season-card-header-top flex items-center justify-between">
            <div className="flex items-center gap-micro flex-1 min-w-0">
              <div className={`w-10 h-10 rounded-full bg-white flex items-center justify-center shadow-sm flex-shrink-0`}>
                <i className={`${sport.icon} ${sport.color} text-lg`}></i>
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-gray-900 truncate">{sport.title}</h3>
                <p className="text-xs text-gray-500 truncate">{getSeasonDisplayName()}</p>
              </div>
            </div>
            {canEdit && (
              <button
                onClick={() => onEdit?.(sport.key, highlight)}
                className="p-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                title="Edit season highlights"
              >
                <i className="fas fa-edit text-sm"></i>
              </button>
            )}
          </div>

          {/* League Chips Row */}
          <div className="season-card-chips">
            {leagueChips.map((league, index) => (
              <div
                key={index}
                className={`season-chip ${
                  league === '—' 
                    ? 'bg-gray-100 text-gray-400' 
                    : `bg-white ${sport.color} border ${sport.borderColor}`
                }`}
              >
                {league}
              </div>
            ))}
          </div>
        </div>

        {/* Stats Grid */}
        <div className="season-card-stats">
          {renderStatGrid(highlight)}
        </div>

        {/* Decorative Footer */}
        <div className="season-card-footer">
          <div className="flex items-center justify-center gap-micro opacity-30">
            <i className={`${sport.icon} text-xs ${sport.color}`}></i>
            <i className="fas fa-trophy text-xs text-yellow-500"></i>
            <i className="fas fa-medal text-xs text-gray-400"></i>
            <i className="fas fa-star text-xs text-yellow-400"></i>
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
      <div className="flex items-center justify-between space-base">
        <h2 className="text-lg font-semibold text-gray-900">Season Highlights</h2>
        <div className="text-sm text-gray-500">
          {getSeasonDisplayName()}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-base">
        {SPORTS_CONFIG.map(sport => renderSportCard(sport))}
      </div>

      {/* Empty State Message */}
      {highlights.length === 0 && (
        <div className="text-center mt-6 py-4">
          <i className="fas fa-chart-line text-3xl text-gray-300 mb-2"></i>
          <p className="text-gray-500 text-sm">
            {PLACEHOLDERS.NO_HIGHLIGHTS}
          </p>
        </div>
      )}
    </div>
  );
}