/**
 * Sport Adapter Interface - Thin layer between UI and sport-specific logic
 * 
 * Core Principles:
 * - UI only talks to adapters, never direct sport logic
 * - Golf implements fully, others return empty/disabled state
 * - All adapters return standardized data structures
 * - Adapters handle sport-specific queries and calculations
 */

import type { SportKey } from './SportRegistry';
import { isSportEnabled } from '../features';
import { getComingSoonMessage } from '../copy';

// Standardized highlight tile data
export interface HighlightTile {
  label: string;
  value: string | null;  // null shows as "—"
  trend?: 'up' | 'down' | 'neutral';  // Optional trend indicator
}

// Standardized activity row data  
export interface ActivityRow {
  id: string;
  col1: string;  // Date/When
  col2: string;  // Event/Opponent/Course
  col3: string;  // Score/Result/Time
  col4: string;  // Key stat/Performance  
  col5?: string; // Organization/League (optional)
  canEdit: boolean;
  canDelete: boolean;
}

// Pagination for activity lists
export interface ActivityResult {
  rows: ActivityRow[];
  hasMore: boolean;
  nextCursor?: string;
}

// Post context for sport-specific composers
export interface PostContext {
  sportKey: SportKey;
  entityId?: string;  // Round ID, Game ID, etc.
  suggestedText?: string;
  attachedMedia?: string[];
}

/**
 * Sport Adapter Interface
 * All adapters must implement these methods
 */
export interface SportAdapter {
  readonly sportKey: SportKey;
  
  /**
   * Get highlight tiles for profile summary
   * @param profileId - User profile ID
   * @param season - Optional season filter
   * @returns Array of standardized tile data
   */
  getHighlights(profileId: string, season?: string): Promise<HighlightTile[]>;
  
  /**
   * Get recent activity rows for the activity table
   * @param profileId - User profile ID  
   * @param limit - Number of rows to return
   * @param cursor - Optional cursor for pagination
   * @returns Standardized activity rows
   */
  getRecentActivity(profileId: string, limit?: number, cursor?: string): Promise<ActivityResult>;
  
  /**
   * Open sport-specific edit dialog
   * @param entityId - Optional entity ID to edit (round, game, etc.)
   * @returns Promise that resolves when edit is complete
   */
  openEditDialog(entityId?: string): Promise<void>;
  
  /**
   * Compose sport-specific post
   * @param context - Post context with sport data
   * @returns Promise that resolves when post is created
   */
  composePost(context: PostContext): Promise<void>;
  
  /**
   * Check if this sport is enabled
   */
  isEnabled(): boolean;
}

/**
 * Base Sport Adapter - Provides disabled/empty implementations
 * Other sports extend this and override only what they need
 */
export abstract class BaseSportAdapter implements SportAdapter {
  readonly sportKey: SportKey;
  
  constructor(sportKey: SportKey) {
    this.sportKey = sportKey;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getHighlights(_profileId: string, _season?: string): Promise<HighlightTile[]> {
    // Default: return empty tiles with labels from registry
    const sport = await import('./SportRegistry').then(m => m.getSportDefinition(this.sportKey));
    const labels = sport.metric_labels;
    
    return [
      { label: labels.tile1, value: null },
      { label: labels.tile2, value: null },
      { label: labels.tile3, value: null },
      { label: labels.tile4, value: null },
      ...(labels.tile5 ? [{ label: labels.tile5, value: null }] : []),
      ...(labels.tile6 ? [{ label: labels.tile6, value: null }] : [])
    ];
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async getRecentActivity(_profileId: string, _limit = 10, _cursor?: string): Promise<ActivityResult> {
    // Default: return empty activity list
    return {
      rows: [],
      hasMore: false
    };
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async openEditDialog(_entityId?: string): Promise<void> {
    // Default: show "coming soon" message using centralized copy
    const message = getComingSoonMessage(this.sportKey, 'editing');
    
    // This will be replaced with actual toast implementation
    console.log(message);
    throw new Error(message);
  }
  
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async composePost(_context: PostContext): Promise<void> {
    // Default: show "coming soon" message using centralized copy
    const message = getComingSoonMessage(this.sportKey, 'activity');
    
    console.log(message);
    throw new Error(message);
  }
  
  isEnabled(): boolean {
    // Check feature flags for sport enablement
    return isSportEnabled(this.sportKey);
  }
}

/**
 * Disabled Sport Adapter - For sports that are registered but not implemented
 * Used for ice hockey, volleyball, etc. in Sprint 0
 */
export class DisabledSportAdapter extends BaseSportAdapter {
  constructor(sportKey: SportKey) {
    super(sportKey);
  }
  
  isEnabled(): boolean {
    // Also use feature flags for disabled adapters
    // This allows feature flags to override the adapter type
    return isSportEnabled(this.sportKey);
  }
}