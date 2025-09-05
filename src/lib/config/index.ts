/**
 * Central configuration export
 * Single entry point for all configuration imports
 */

// App configuration
export {
  ACTIVE_SEASON,
  PLACEHOLDERS,
  APP_CONFIG,
  getActiveSeason,
  getSeasonDisplayName,
  getPlaceholder,
  formatEmptyValue,
  isFeatureEnabled,
  getAppLimit,
} from './app-config';

// Sports configuration
export {
  SPORT_ICONS,
  SPORT_COLORS,
  SPORT_NAMES,
  SPORT_CATEGORIES,
  SPORT_TAILWIND_COLORS,
  getSportIcon,
  getSportColor,
  getSportName,
  getSportCategory,
  getSportMetadata,
  getSportTailwindClasses,
  getAllSports,
  getSportsByCategory,
  type SportMetadata,
} from './sports-config';

// Import necessary items for getConfiguration
import { ACTIVE_SEASON as ActiveSeasonConfig, APP_CONFIG as AppConfigData } from './app-config';

// Common configuration types
export interface AppConfiguration {
  season: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

// Helper to get all configuration
export function getConfiguration(): AppConfiguration {
  return {
    season: ActiveSeasonConfig,
    features: AppConfigData.features,
    limits: AppConfigData.limits,
  };
}