/**
 * League configuration and metadata
 * Defines display properties for various athletic leagues and organizations
 */

export interface LeagueConfig {
  key: string;
  displayName: string;
  shortName: string;
  color: string;        // Text color
  bgColor: string;      // Background color
  borderColor: string;  // Border color
  category: 'collegiate' | 'professional' | 'club' | 'international' | 'youth';
}

/**
 * League configurations by key
 */
export const LEAGUE_CONFIGS: Record<string, LeagueConfig> = {
  // Collegiate
  ncaa_d1: {
    key: 'ncaa_d1',
    displayName: 'NCAA Division I',
    shortName: 'NCAA D1',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    category: 'collegiate'
  },
  ncaa_d2: {
    key: 'ncaa_d2',
    displayName: 'NCAA Division II',
    shortName: 'NCAA D2',
    color: 'text-blue-500',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    category: 'collegiate'
  },
  ncaa_d3: {
    key: 'ncaa_d3',
    displayName: 'NCAA Division III',
    shortName: 'NCAA D3',
    color: 'text-blue-400',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    category: 'collegiate'
  },
  naia: {
    key: 'naia',
    displayName: 'NAIA',
    shortName: 'NAIA',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    category: 'collegiate'
  },
  njcaa: {
    key: 'njcaa',
    displayName: 'NJCAA',
    shortName: 'NJCAA',
    color: 'text-indigo-600',
    bgColor: 'bg-indigo-50',
    borderColor: 'border-indigo-200',
    category: 'collegiate'
  },
  
  // Conferences
  big_ten: {
    key: 'big_ten',
    displayName: 'Big Ten Conference',
    shortName: 'Big Ten',
    color: 'text-slate-700',
    bgColor: 'bg-slate-50',
    borderColor: 'border-slate-200',
    category: 'collegiate'
  },
  sec: {
    key: 'sec',
    displayName: 'Southeastern Conference',
    shortName: 'SEC',
    color: 'text-amber-600',
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    category: 'collegiate'
  },
  acc: {
    key: 'acc',
    displayName: 'Atlantic Coast Conference',
    shortName: 'ACC',
    color: 'text-sky-600',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    category: 'collegiate'
  },
  pac_12: {
    key: 'pac_12',
    displayName: 'Pac-12 Conference',
    shortName: 'Pac-12',
    color: 'text-emerald-600',
    bgColor: 'bg-emerald-50',
    borderColor: 'border-emerald-200',
    category: 'collegiate'
  },
  big_12: {
    key: 'big_12',
    displayName: 'Big 12 Conference',
    shortName: 'Big 12',
    color: 'text-red-600',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    category: 'collegiate'
  },
  
  // Professional
  nhl: {
    key: 'nhl',
    displayName: 'National Hockey League',
    shortName: 'NHL',
    color: 'text-gray-800',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-300',
    category: 'professional'
  },
  ahl: {
    key: 'ahl',
    displayName: 'American Hockey League',
    shortName: 'AHL',
    color: 'text-orange-600',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    category: 'professional'
  },
  echl: {
    key: 'echl',
    displayName: 'East Coast Hockey League',
    shortName: 'ECHL',
    color: 'text-teal-600',
    bgColor: 'bg-teal-50',
    borderColor: 'border-teal-200',
    category: 'professional'
  },
  
  // Club Sports
  usav: {
    key: 'usav',
    displayName: 'USA Volleyball',
    shortName: 'USAV',
    color: 'text-blue-700',
    bgColor: 'bg-blue-50',
    borderColor: 'border-blue-200',
    category: 'club'
  },
  aau: {
    key: 'aau',
    displayName: 'Amateur Athletic Union',
    shortName: 'AAU',
    color: 'text-purple-700',
    bgColor: 'bg-purple-50',
    borderColor: 'border-purple-200',
    category: 'club'
  },
  usatf: {
    key: 'usatf',
    displayName: 'USA Track & Field',
    shortName: 'USATF',
    color: 'text-red-700',
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    category: 'club'
  },
  
  // Youth/High School
  nfhs: {
    key: 'nfhs',
    displayName: 'National Federation of State High School Associations',
    shortName: 'NFHS',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    category: 'youth'
  },
  prep: {
    key: 'prep',
    displayName: 'Prep League',
    shortName: 'Prep',
    color: 'text-cyan-600',
    bgColor: 'bg-cyan-50',
    borderColor: 'border-cyan-200',
    category: 'youth'
  },
  
  // International
  fiba: {
    key: 'fiba',
    displayName: 'International Basketball Federation',
    shortName: 'FIBA',
    color: 'text-orange-700',
    bgColor: 'bg-orange-50',
    borderColor: 'border-orange-200',
    category: 'international'
  },
  fivb: {
    key: 'fivb',
    displayName: 'International Volleyball Federation',
    shortName: 'FIVB',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-50',
    borderColor: 'border-yellow-200',
    category: 'international'
  },
  iihf: {
    key: 'iihf',
    displayName: 'International Ice Hockey Federation',
    shortName: 'IIHF',
    color: 'text-sky-700',
    bgColor: 'bg-sky-50',
    borderColor: 'border-sky-200',
    category: 'international'
  }
};

/**
 * Get league configuration by key or display name
 */
export function getLeagueConfig(identifier: string): LeagueConfig | null {
  // First try direct key lookup
  const directMatch = LEAGUE_CONFIGS[identifier.toLowerCase().replace(/\s+/g, '_')];
  if (directMatch) return directMatch;
  
  // Then try to match by shortName or displayName
  const normalizedId = identifier.toLowerCase();
  for (const config of Object.values(LEAGUE_CONFIGS)) {
    if (config.shortName.toLowerCase() === normalizedId ||
        config.displayName.toLowerCase() === normalizedId) {
      return config;
    }
  }
  
  return null;
}

/**
 * Get display properties for a league chip
 */
export function getLeagueChipStyles(leagueName: string): {
  text: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  const config = getLeagueConfig(leagueName);
  
  if (!config) {
    // Default styling for unknown leagues
    return {
      text: leagueName,
      color: 'text-gray-600',
      bgColor: 'bg-gray-50',
      borderColor: 'border-gray-200'
    };
  }
  
  return {
    text: config.shortName,
    color: config.color,
    bgColor: config.bgColor,
    borderColor: config.borderColor
  };
}

/**
 * Format league tags for display (always returns exactly 2)
 */
export function formatLeagueTags(tags?: string[]): Array<{ text: string; styles: ReturnType<typeof getLeagueChipStyles> }> {
  const result = [];
  
  // Add up to 2 league tags
  for (let i = 0; i < 2; i++) {
    const tag = tags?.[i];
    if (tag) {
      result.push({
        text: tag,
        styles: getLeagueChipStyles(tag)
      });
    } else {
      // Empty placeholder
      result.push({
        text: '—',
        styles: {
          text: '—',
          color: 'text-gray-400',
          bgColor: 'bg-gray-100',
          borderColor: 'border-gray-200'
        }
      });
    }
  }
  
  return result;
}