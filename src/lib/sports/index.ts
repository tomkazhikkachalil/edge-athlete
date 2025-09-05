/**
 * Sports System - Main Exports
 * 
 * Central entry point for all sports-related functionality
 * Use these exports in UI components instead of direct imports
 */

// Sport Registry exports
export type { SportKey, SportDefinition, SportMetricLabels, SportActivityColumns } from './SportRegistry';
import type { SportKey } from './SportRegistry';
export { 
  SPORT_REGISTRY, 
  getSportDefinition, 
  getEnabledSports as getEnabledSportsFromRegistry,
  getAllSports as getAllSportsFromRegistry,
  getDisabledSports 
} from './SportRegistry';

// Sport Adapter exports  
export type { SportAdapter, HighlightTile, ActivityRow, ActivityResult, PostContext } from './SportAdapter';
import type { PostContext } from './SportAdapter';
export { BaseSportAdapter, DisabledSportAdapter } from './SportAdapter';

// Adapter Registry exports (Primary UI Interface)
export { 
  adapterRegistry,
  getSportAdapter, 
  getEnabledSports,
  getAllSports,
  isSportEnabled 
} from './AdapterRegistry';
import { getSportAdapter } from './AdapterRegistry';

// Golf Adapter export
export { GolfAdapter } from './adapters/GolfAdapter';

// Convenience functions for common UI patterns  
export const getCurrentSportAdapter = (sportKey: SportKey) => {
  return getSportAdapter(sportKey);
};

export const getHighlightsForProfile = async (sportKey: SportKey, profileId: string, season?: string) => {
  const adapter = getSportAdapter(sportKey);
  return adapter.getHighlights(profileId, season);
};

export const getActivityForProfile = async (sportKey: SportKey, profileId: string, limit?: number) => {
  const adapter = getSportAdapter(sportKey);
  return adapter.getRecentActivity(profileId, limit);
};

export const openSportEditor = async (sportKey: SportKey, entityId?: string) => {
  const adapter = getSportAdapter(sportKey);
  return adapter.openEditDialog(entityId);
};

export const createSportPost = async (sportKey: SportKey, context: PostContext) => {
  const adapter = getSportAdapter(sportKey);
  return adapter.composePost(context);
};