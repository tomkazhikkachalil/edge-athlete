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
    color: 'text-sky-500 dark:text-sky-400',
    bgColor: 'bg-sky-50 dark:bg-sky-950/40',
    borderColor: 'border-sky-200 dark:border-sky-800',
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
    color: 'text-amber-500 dark:text-amber-400',
    bgColor: 'bg-amber-50 dark:bg-amber-950/40',
    borderColor: 'border-amber-200 dark:border-amber-800',
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
    color: 'text-blue-500 dark:text-blue-400',
    bgColor: 'bg-blue-50 dark:bg-blue-950/40',
    borderColor: 'border-blue-200 dark:border-blue-800',
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
    color: 'text-orange-500 dark:text-orange-400',
    bgColor: 'bg-orange-50 dark:bg-orange-950/40',
    borderColor: 'border-orange-200 dark:border-orange-800',
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
    color: 'text-green-600 dark:text-green-400',
    bgColor: 'bg-green-50 dark:bg-green-950/40',
    borderColor: 'border-green-200 dark:border-green-800',
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
    color: 'text-emerald-500 dark:text-emerald-400',
    bgColor: 'bg-emerald-50 dark:bg-emerald-950/40',
    borderColor: 'border-emerald-200 dark:border-emerald-800',
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
    color: 'text-red-500 dark:text-red-400',
    bgColor: 'bg-red-50 dark:bg-red-950/40',
    borderColor: 'border-red-200 dark:border-red-800',
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
    color: 'text-cyan-500 dark:text-cyan-400',
    bgColor: 'bg-cyan-50 dark:bg-cyan-950/40',
    borderColor: 'border-cyan-200 dark:border-cyan-800',
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
    color: 'text-lime-600 dark:text-lime-400',
    bgColor: 'bg-lime-50 dark:bg-lime-950/40',
    borderColor: 'border-lime-200 dark:border-lime-800',
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
    color: 'text-purple-600 dark:text-purple-400',
    bgColor: 'bg-purple-50 dark:bg-purple-950/40',
    borderColor: 'border-purple-200 dark:border-purple-800',
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
    color: 'text-gray-500 dark:text-stone-400',
    bgColor: 'bg-gray-50 dark:bg-stone-900',
    borderColor: 'border-gray-200 dark:border-stone-700',
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