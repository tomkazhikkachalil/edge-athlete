'use client';

import { useState, useMemo } from 'react';
import { getAllSports, type SportKey } from '@/lib/sports/SportRegistry';

interface SportSelectorProps {
  selectedSport: SportKey | 'general';
  onSelectSport: (sportKey: SportKey | 'general') => void;
  onClose: () => void;
}

export default function SportSelector({ selectedSport, onSelectSport, onClose }: SportSelectorProps) {
  const [searchQuery, setSearchQuery] = useState('');

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-bold text-gray-900">Select Sport</h3>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
            aria-label="Close"
          >
            <i className="fas fa-times text-gray-500"></i>
          </button>
        </div>

        {/* Search Bar */}
        <div className="p-4 border-b border-gray-200">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search sports..."
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              autoFocus
            />
          </div>
        </div>

        {/* Content - Scrollable */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* General Post Option */}
          <div className="mb-6">
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              General
            </h4>
            <button
              onClick={handleSelectGeneral}
              className={`w-full p-3 border-2 rounded-lg text-left transition-all flex items-center gap-3 ${
                selectedSport === 'general'
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }`}
            >
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
                selectedSport === 'general' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-500'
              }`}>
                <i className="fas fa-edit"></i>
              </div>
              <div className="flex-1">
                <div className="font-semibold text-gray-900">General Post</div>
                <div className="text-sm text-gray-500">Text, photos, and hashtags</div>
              </div>
              {selectedSport === 'general' && (
                <i className="fas fa-check-circle text-blue-600 text-xl"></i>
              )}
            </button>
          </div>

          {/* Favorites Section (Future) */}
          {favoriteSports.length > 0 && (
            <div className="mb-6">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                <i className="fas fa-star mr-1"></i>
                Favorites
              </h4>
              <div className="grid grid-cols-2 gap-2">
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
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                <i className="fas fa-clock mr-1"></i>
                Recently Used
              </h4>
              <div className="grid grid-cols-2 gap-2">
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
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              All Sports
            </h4>
            {filteredSports.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <i className="fas fa-search text-3xl mb-2"></i>
                <p>No sports found</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
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
        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <div className="flex items-start gap-2 text-sm text-gray-600">
            <i className="fas fa-info-circle mt-0.5"></i>
            <p>
              <span className="font-semibold">Coming Soon:</span> More sports will be available in future updates.
              Currently, only Golf is fully active.
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
          ? 'border-blue-500 bg-blue-50'
          : isDisabled
            ? 'border-gray-200 bg-gray-50 opacity-60 cursor-not-allowed'
            : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
      }`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${
          isSelected
            ? 'bg-blue-600 text-white'
            : isDisabled
              ? 'bg-gray-200 text-gray-400'
              : 'bg-gray-100 text-gray-600'
        }`}>
          <i className={sport.icon_id}></i>
        </div>
        <div className="flex-1 min-w-0">
          <div className={`font-semibold truncate ${
            isDisabled ? 'text-gray-400' : 'text-gray-900'
          }`}>
            {sport.display_name}
          </div>
          {isDisabled && (
            <div className="text-xs text-gray-400 mt-0.5">Coming soon</div>
          )}
        </div>
        {isSelected && !isDisabled && (
          <i className="fas fa-check-circle text-blue-600"></i>
        )}
        {isDisabled && (
          <i className="fas fa-lock text-gray-300 text-sm"></i>
        )}
      </div>
    </button>
  );
}
