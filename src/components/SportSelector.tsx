'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAllSports, type SportKey } from '@/lib/sports/SportRegistry';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';

interface SportSelectorProps {
  selectedSport: SportKey | 'general';
  onSelectSport: (sportKey: SportKey | 'general') => void;
  onClose: () => void;
}

export default function SportSelector({ selectedSport, onSelectSport, onClose }: SportSelectorProps) {
  // Mounted only while open — lock background scroll for the whole lifetime
  useBodyScrollLock();

  const [searchQuery, setSearchQuery] = useState('');

  // Focus the search only where a keyboard is already there (a fine pointer).
  // Tom (Oct 22 2026, iPhone): after a cold open, Create → Sport zoomed the
  // screen to the far left — this picker mounts inside the composer's lazy
  // chunk, so on the first open its mount (and a bare `autoFocus`) lands
  // AFTER the tap, outside the gesture, and iOS reveals the field by zooming
  // to it. A phone opens the picker with the sport grid in view and no
  // keyboard (the list is the point; search is optional); the desktop keeps
  // typing straight away. Never fixed by disabling page zoom.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    searchRef.current?.focus({ preventScroll: true });
  }, []);

  const allSports = getAllSports();

  // Future: This will be populated from user's activity
  const favoriteSports: SportKey[] = [];
  const recentSports: SportKey[] = [];

  // Filter sports based on search
  const filteredSports = useMemo(() => {
    if (!searchQuery.trim()) return allSports;

    const query = searchQuery.toLowerCase();
    return allSports.filter(sport =>
      sport.display_name.toLowerCase().includes(query) ||
      sport.sport_key.toLowerCase().includes(query)
    );
  }, [searchQuery, allSports]);

  const handleSelectSport = (sportKey: SportKey) => {
    const sport = allSports.find(s => s.sport_key === sportKey);
    if (sport?.enabled) {
      onSelectSport(sportKey);
      onClose();
    }
  };

  const handleSelectGeneral = () => {
    onSelectSport('general');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] p-4">
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-2xl w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border">
          <h3 className="text-lg font-bold text-primary">Select Sport</h3>
          <button
            onClick={onClose}
            className="ea-icon-btn inline-flex items-center justify-center"
            aria-label="Close"
          >
            <i className="fas fa-times text-muted"></i>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-border">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-decor"></i>
            <input
              ref={searchRef}
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sports..."
              // text-base: 16 px at EVERY width — iOS zooms into a focused field under 16 px.
              className="w-full pl-10 pr-4 py-2 text-base border border-border-strong rounded-lg focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
              data-sport-search=""
            />
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* General Post Option */}
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              General
            </h4>
            <button
              onClick={handleSelectGeneral}
              className={`w-full p-3 border-2 rounded-lg text-left transition-all flex items-center gap-3 ${
                selectedSport === 'general'
                  ? 'border-violet-500 bg-brand-soft'
                  : 'border-border hover:border-border-strong hover:bg-surface-muted'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                selectedSport === 'general' ? 'bg-brand text-white' : 'bg-surface-sunken text-muted'
              }`}>
                <i className="fas fa-edit"></i>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-primary">General Post</div>
                <div className="text-sm text-muted">Text, photos, and hashtags</div>
              </div>
              {selectedSport === 'general' && (
                <i className="fas fa-check-circle text-brand-fg text-xl"></i>
              )}
            </button>
          </div>

          {/* Favorites Section (Future) */}
          {favoriteSports.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                <i className="fas fa-star mr-1"></i>
                Favorites
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {favoriteSports.map(sportKey => {
                  const sport = allSports.find(s => s.sport_key === sportKey);
                  if (!sport) return null;
                  return (
                    <SportCard
                      key={sport.sport_key}
                      sport={sport}
                      isSelected={selectedSport === sport.sport_key}
                      onSelect={handleSelectSport}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Recent Section (Future) */}
          {recentSports.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
                <i className="fas fa-clock mr-1"></i>
                Recently Used
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {recentSports.map(sportKey => {
                  const sport = allSports.find(s => s.sport_key === sportKey);
                  if (!sport) return null;
                  return (
                    <SportCard
                      key={sport.sport_key}
                      sport={sport}
                      isSelected={selectedSport === sport.sport_key}
                      onSelect={handleSelectSport}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* All Sports */}
          <div>
            <h4 className="text-xs font-semibold text-muted uppercase tracking-wide mb-2">
              All Sports
            </h4>
            {filteredSports.length === 0 ? (
              <div className="text-center py-8 text-muted">
                <i className="fas fa-search text-3xl mb-2"></i>
                <p>No sports found</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {filteredSports.map(sport => (
                  <SportCard
                    key={sport.sport_key}
                    sport={sport}
                    isSelected={selectedSport === sport.sport_key}
                    onSelect={handleSelectSport}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Info */}
        <div className="p-4 border-t border-border bg-surface-muted">
          <div className="flex items-start gap-2 text-sm text-tertiary">
            <i className="fas fa-info-circle mt-0.5"></i>
            <p>
              <span className="font-semibold">Coming Soon:</span> More sports will be available in future updates.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Sport Card Component
interface SportCardProps {
  sport: {
    sport_key: SportKey;
    display_name: string;
    icon_id: string;
    enabled: boolean;
    brand_color_token: string;
  };
  isSelected: boolean;
  onSelect: (sportKey: SportKey) => void;
}

function SportCard({ sport, isSelected, onSelect }: SportCardProps) {
  const isDisabled = !sport.enabled;

  return (
    <button
      onClick={() => !isDisabled && onSelect(sport.sport_key)}
      disabled={isDisabled}
      className={`relative p-3 border-2 rounded-lg text-left transition-all ${
        isSelected
          ? 'border-violet-500 bg-brand-soft'
          : isDisabled
            ? 'border-border bg-surface-muted opacity-60 cursor-not-allowed'
            : 'border-border hover:border-border-strong hover:bg-surface-muted'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isSelected
            ? 'bg-brand text-white'
            : isDisabled
              ? 'bg-gray-200 dark:bg-stone-800 text-faint'
              : 'bg-surface-sunken text-tertiary'
        }`}>
          <i className={sport.icon_id}></i>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${
            isDisabled ? 'text-faint' : 'text-primary'
          }`}>
            {sport.display_name}
          </div>
          {isDisabled && (
            <div className="text-xs text-faint mt-0.5">Coming soon</div>
          )}
        </div>
        {isSelected && !isDisabled && (
          <i className="fas fa-check-circle text-brand-fg"></i>
        )}
        {isDisabled && (
          <i className="fas fa-lock text-gray-300 dark:text-stone-600 text-sm"></i>
        )}
      </div>
    </button>
  );
}
