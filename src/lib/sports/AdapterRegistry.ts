/**
 * Adapter Registry - Central registration and access for sport adapters
 * 
 * Core Principles:
 * - Single point of access for all sport adapters
 * - Golf adapter is registered and enabled
 * - Other sports use disabled adapters (return empty data)
 * - UI components only access sports through this registry
 */

import type { SportKey } from './SportRegistry';
import type { SportAdapter } from './SportAdapter';
import { DisabledSportAdapter } from './SportAdapter';
import { GolfAdapter } from './adapters/GolfAdapter';

/**
 * Adapter Registry Class
 * Manages registration and retrieval of sport adapters
 */
class AdapterRegistry {
  private adapters = new Map<SportKey, SportAdapter>();
  
  constructor() {
    this.registerDefaultAdapters();
  }
  
  /**
   * Register all default adapters
   * Golf: Full implementation
   * Others: Disabled adapters
   */
  private registerDefaultAdapters(): void {
    // Golf - V1 Implementation (Enabled)
    this.register(new GolfAdapter());
    
    // Other Sports - Disabled (Coming Soon)
    const disabledSports: SportKey[] = [
      'ice_hockey',
      'volleyball', 
      'track_field',
      'basketball',
      'soccer',
      'tennis',
      'swimming',
      'baseball',
      'football'
    ];
    
    disabledSports.forEach(sportKey => {
      this.register(new DisabledSportAdapter(sportKey));
    });
  }
  
  /**
   * Register a sport adapter
   */
  register(adapter: SportAdapter): void {
    this.adapters.set(adapter.sportKey, adapter);
  }
  
  /**
   * Get adapter for a specific sport
   */
  getAdapter(sportKey: SportKey): SportAdapter {
    const adapter = this.adapters.get(sportKey);
    if (!adapter) {
      throw new Error(`No adapter registered for sport: ${sportKey}`);
    }
    return adapter;
  }
  
  /**
   * Get all enabled adapters
   */
  getEnabledAdapters(): SportAdapter[] {
    return Array.from(this.adapters.values()).filter(adapter => adapter.isEnabled());
  }
  
  /**
   * Get all disabled adapters  
   */
  getDisabledAdapters(): SportAdapter[] {
    return Array.from(this.adapters.values()).filter(adapter => !adapter.isEnabled());
  }
  
  /**
   * Get all registered adapters
   */
  getAllAdapters(): SportAdapter[] {
    return Array.from(this.adapters.values());
  }
  
  /**
   * Check if a sport is enabled
   */
  isSportEnabled(sportKey: SportKey): boolean {
    const adapter = this.adapters.get(sportKey);
    return adapter ? adapter.isEnabled() : false;
  }
}

// Export singleton instance
export const adapterRegistry = new AdapterRegistry();

// Convenience functions for common operations
export const getSportAdapter = (sportKey: SportKey): SportAdapter => {
  return adapterRegistry.getAdapter(sportKey);
};

export const getEnabledSports = (): SportAdapter[] => {
  return adapterRegistry.getEnabledAdapters();
};

export const getAllSports = (): SportAdapter[] => {
  return adapterRegistry.getAllAdapters();
};

export const isSportEnabled = (sportKey: SportKey): boolean => {
  return adapterRegistry.isSportEnabled(sportKey);
};