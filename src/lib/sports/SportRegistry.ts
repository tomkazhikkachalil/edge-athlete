/**
 * Central Sport Registry - Single source of truth for all sport configurations
 * 
 * Core Principles:
 * - One layout, many sports
 * - Golf is v1 implementation (fully functional)
 * - Other sports are registered but disabled
 * - All sport-specific logic lives in adapters, not components
 */

export type SportKey = 
  | 'golf'
  | 'ice_hockey' 
  | 'volleyball'
  | 'track_field'
  | 'basketball'
  | 'soccer'
  | 'tennis'
  | 'swimming'
  | 'baseball'
  | 'football';

export interface SportMetricLabels {
  tile1: string;  // Primary stat (e.g., "Last 5 Avg", "Goals")
  tile2: string;  // Secondary stat (e.g., "Best 18", "Assists")  
  tile3: string;  // Tertiary stat (e.g., "FIR%", "Games")
  tile4: string;  // Performance metric (e.g., "GIR%", "Rating")
  tile5?: string; // Optional fifth tile
  tile6?: string; // Optional sixth tile
}

export interface SportActivityColumns {
  col1: string;   // Date/When
  col2: string;   // Event/Opponent/Course
  col3: string;   // Score/Result/Time
  col4: string;   // Key stat/Performance
  col5?: string;  // Organization/League
}

export interface SportDefinition {
  sport_key: SportKey;
  display_name: string;
  brand_color_token: string;
  icon_id: string;
  enabled: boolean;                    // v1: only golf true
  metric_labels: SportMetricLabels;
  activity_columns: SportActivityColumns;
  primary_action: string;              // "Add Round", "Add Game", etc.
}

/**
 * Master Sport Registry
 * Golf: Fully implemented and enabled
 * Others: Complete definitions but disabled until future sprints
 */
export const SPORT_REGISTRY: Record<SportKey, SportDefinition> = {
  // === GOLF (V1 Implementation) ===
  golf: {
    sport_key: 'golf',
    display_name: 'Golf',
    brand_color_token: 'green',
    icon_id: 'fas fa-golf-ball',
    enabled: true,
    metric_labels: {
      tile1: 'Last 5 Avg',
      tile2: 'Best 18',
      tile3: 'FIR%',
      tile4: 'GIR%',
      tile5: 'Putts/Round',
      tile6: 'Scrambling%'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Course',
      col3: 'Score',
      col4: 'GIR',
      col5: 'Tournament'
    },
    primary_action: 'Add Round'
  },

  // === ICE HOCKEY (Future Implementation) ===
  ice_hockey: {
    sport_key: 'ice_hockey',
    display_name: 'Ice Hockey',
    brand_color_token: 'blue',
    icon_id: 'fas fa-hockey-puck',
    enabled: false,
    metric_labels: {
      tile1: 'Goals',
      tile2: 'Assists',
      tile3: 'Games',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Points',
      col5: 'League'
    },
    primary_action: 'Add Game'
  },

  // === VOLLEYBALL (Future Implementation) ===
  volleyball: {
    sport_key: 'volleyball',
    display_name: 'Volleyball',
    brand_color_token: 'orange',
    icon_id: 'fas fa-volleyball-ball',
    enabled: false,
    metric_labels: {
      tile1: 'Kills',
      tile2: 'Blocks',
      tile3: 'Sets',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Kills',
      col5: 'Tournament'
    },
    primary_action: 'Add Match'
  },

  // === TRACK & FIELD (Future Implementation) ===
  track_field: {
    sport_key: 'track_field',
    display_name: 'Track & Field',
    brand_color_token: 'red',
    icon_id: 'fas fa-running',
    enabled: false,
    metric_labels: {
      tile1: '100m PR',
      tile2: '200m PR',
      tile3: 'Events',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Event',
      col3: 'Time',
      col4: 'Place',
      col5: 'Meet'
    },
    primary_action: 'Add Performance'
  },

  // === BASKETBALL (Future Implementation) ===
  basketball: {
    sport_key: 'basketball',
    display_name: 'Basketball',
    brand_color_token: 'orange',
    icon_id: 'fas fa-basketball-ball',
    enabled: false,
    metric_labels: {
      tile1: 'PPG',
      tile2: 'RPG',
      tile3: 'APG',
      tile4: 'FG%'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Points',
      col5: 'League'
    },
    primary_action: 'Add Game'
  },

  // === SOCCER (Future Implementation) ===
  soccer: {
    sport_key: 'soccer',
    display_name: 'Soccer',
    brand_color_token: 'emerald',
    icon_id: 'fas fa-futbol',
    enabled: false,
    metric_labels: {
      tile1: 'Goals',
      tile2: 'Assists',
      tile3: 'Games',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Goals',
      col5: 'League'
    },
    primary_action: 'Add Match'
  },

  // === TENNIS (Future Implementation) ===
  tennis: {
    sport_key: 'tennis',
    display_name: 'Tennis',
    brand_color_token: 'yellow',
    icon_id: 'fas fa-table-tennis',
    enabled: false,
    metric_labels: {
      tile1: 'Wins',
      tile2: 'Win%',
      tile3: 'Matches',
      tile4: 'Ranking'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Sets',
      col5: 'Tournament'
    },
    primary_action: 'Add Match'
  },

  // === SWIMMING (Future Implementation) ===
  swimming: {
    sport_key: 'swimming',
    display_name: 'Swimming',
    brand_color_token: 'cyan',
    icon_id: 'fas fa-swimmer',
    enabled: false,
    metric_labels: {
      tile1: '50 Free PR',
      tile2: '100 Free PR',
      tile3: 'Events',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Event',
      col3: 'Time',
      col4: 'Place',
      col5: 'Meet'
    },
    primary_action: 'Add Race'
  },

  // === BASEBALL (Future Implementation) ===
  baseball: {
    sport_key: 'baseball',
    display_name: 'Baseball',
    brand_color_token: 'indigo',
    icon_id: 'fas fa-baseball-ball',
    enabled: false,
    metric_labels: {
      tile1: 'AVG',
      tile2: 'HR',
      tile3: 'RBI',
      tile4: 'OPS'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Hits',
      col5: 'League'
    },
    primary_action: 'Add Game'
  },

  // === FOOTBALL (Future Implementation) ===
  football: {
    sport_key: 'football',
    display_name: 'Football',
    brand_color_token: 'amber',
    icon_id: 'fas fa-football-ball',
    enabled: false,
    metric_labels: {
      tile1: 'Touchdowns',
      tile2: 'Yards',
      tile3: 'Games',
      tile4: 'Rating'
    },
    activity_columns: {
      col1: 'Date',
      col2: 'Opponent',
      col3: 'Result',
      col4: 'Stats',
      col5: 'League'
    },
    primary_action: 'Add Game'
  }
};

// Utility functions for registry access
export const getSportDefinition = (sportKey: SportKey): SportDefinition => {
  return SPORT_REGISTRY[sportKey];
};

export const getEnabledSports = (): SportDefinition[] => {
  return Object.values(SPORT_REGISTRY).filter(sport => sport.enabled);
};

export const getAllSports = (): SportDefinition[] => {
  return Object.values(SPORT_REGISTRY);
};

export const getDisabledSports = (): SportDefinition[] => {
  return Object.values(SPORT_REGISTRY).filter(sport => !sport.enabled);
};