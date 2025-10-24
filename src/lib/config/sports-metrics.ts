/**
 * Sport-specific metric configurations
 * Defines display names, icons, colors, and metric labels for each sport
 */

export interface SportMetricConfig {
  key: string;
  displayName: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
  metrics: {
    a: string;  // First metric label
    b: string;  // Second metric label
    c: string;  // Third metric label
    rating: string;  // Always "Rating" but included for consistency
  };
}

/**
 * Sport metrics configuration mapping
 * Each sport has its own specific metric labels that make sense for that sport
 */
export const SPORT_METRICS: Record<string, SportMetricConfig> = {
  ice_hockey: {
    key: 'ice_hockey',
    displayName: 'Ice Hockey',
    icon: 'fas fa-hockey-puck',
    color: 'text-sky-500',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    metrics: {
      a: 'Goals',
      b: 'Assists',
      c: 'Games',
      rating: 'Rating'
    }
  },
  volleyball: {
    key: 'volleyball',
    displayName: 'Volleyball',
    icon: 'fas fa-volleyball-ball',
    color: 'text-amber-500',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    metrics: {
      a: 'Kills',
      b: 'Blocks',
      c: 'Aces',
      rating: 'Rating'
    }
  },
  track_field: {
    key: 'track_field',
    displayName: 'Track & Field',
    icon: 'fas fa-running',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    metrics: {
      a: '100m Best',
      b: '200m Best',
      c: 'Medals',
      rating: 'Rating'
    }
  },
  basketball: {
    key: 'basketball',
    displayName: 'Basketball',
    icon: 'fas fa-basketball-ball',
    color: 'text-orange-500',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    metrics: {
      a: 'Points',
      b: 'Rebounds',
      c: 'Assists',
      rating: 'Rating'
    }
  },
  football: {
    key: 'football',
    displayName: 'Football',
    icon: 'fas fa-football-ball',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    metrics: {
      a: 'Yards',
      b: 'Touchdowns',
      c: 'Completions',
      rating: 'Rating'
    }
  },
  soccer: {
    key: 'soccer',
    displayName: 'Soccer',
    icon: 'fas fa-futbol',
    color: 'text-emerald-500',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    metrics: {
      a: 'Goals',
      b: 'Assists',
      c: 'Matches',
      rating: 'Rating'
    }
  },
  baseball: {
    key: 'baseball',
    displayName: 'Baseball',
    icon: 'fas fa-baseball-ball',
    color: 'text-red-500',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    metrics: {
      a: 'Batting Avg',
      b: 'Home Runs',
      c: 'RBIs',
      rating: 'Rating'
    }
  },
  swimming: {
    key: 'swimming',
    displayName: 'Swimming',
    icon: 'fas fa-swimmer',
    color: 'text-cyan-500',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
    metrics: {
      a: '50m Free',
      b: '100m Free',
      c: 'Medals',
      rating: 'Rating'
    }
  },
  tennis: {
    key: 'tennis',
    displayName: 'Tennis',
    icon: 'fas fa-table-tennis',
    color: 'text-lime-600',
    bgColor: 'bg-lime-50',
    borderColor: 'border-lime-200',
    metrics: {
      a: 'Wins',
      b: 'Aces',
      c: 'Ranking',
      rating: 'Rating'
    }
  },
  wrestling: {
    key: 'wrestling',
    displayName: 'Wrestling',
    icon: 'fas fa-fist-raised',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    metrics: {
      a: 'Wins',
      b: 'Pins',
      c: 'Takedowns',
      rating: 'Rating'
    }
  }
};

/**
 * Default fallback metrics for unknown sports
 */
export const DEFAULT_METRICS = {
  a: 'Metric A',
  b: 'Metric B',
  c: 'Metric C',
  rating: 'Rating'
};

/**
 * Get sport configuration by key
 * Returns default configuration if sport is not found
 */
export function getSportConfig(sportKey: string): SportMetricConfig {
  return SPORT_METRICS[sportKey] || {
    key: sportKey,
    displayName: sportKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    icon: 'fas fa-trophy',
    color: 'text-gray-500',
    bgColor: 'bg-gray-50',
    borderColor: 'border-gray-200',
    metrics: DEFAULT_METRICS
  };
}

/**
 * Get metric labels for a specific sport
 */
export function getSportMetrics(sportKey: string) {
  const config = getSportConfig(sportKey);
  return config.metrics;
}

/**
 * Get list of available sports for display
 * Returns only the three main sports by default
 */
export function getDisplaySports(): SportMetricConfig[] {
  return [
    SPORT_METRICS.ice_hockey,
    SPORT_METRICS.volleyball,
    SPORT_METRICS.track_field
  ];
}