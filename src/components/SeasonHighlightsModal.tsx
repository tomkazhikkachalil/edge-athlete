'use client';

import { useState, useEffect } from 'react';
import type { SeasonHighlight } from '@/lib/supabase';
import { getSportConfig, getActiveSeason, getSeasonDisplayName } from '@/lib/config';
import { LEAGUE_CONFIGS } from '@/lib/config/league-config';

interface SeasonHighlightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sportKey: string;
  existingData?: SeasonHighlight;
  onSave: (data: Partial<SeasonHighlight>) => Promise<void>;
}

// Get available league options for multi-select
const LEAGUE_OPTIONS = Object.values(LEAGUE_CONFIGS).map(config => ({
  key: config.key,
  label: config.shortName,
  fullLabel: config.displayName,
  category: config.category
}));

interface FormData {
  sport_key: string;
  season: string;
  metric_a: string;
  metric_b: string;
  metric_c: string;
  rating: number | string;
  league_tags: string[];
}

export default function SeasonHighlightsModal({
  isOpen,
  onClose,
  sportKey,
  existingData,
  onSave
}: SeasonHighlightsModalProps) {
  const [formData, setFormData] = useState<FormData>({
    sport_key: sportKey,
    season: '',
    metric_a: '',
    metric_b: '',
    metric_c: '',
    rating: '',
    league_tags: []
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Get sport configuration for labels
  const sportConfig = getSportConfig(sportKey);
  const metrics = sportConfig.metrics;

  useEffect(() => {
    if (isOpen) {
      if (existingData) {
        setFormData({
          sport_key: existingData.sport_key,
          season: existingData.season || getActiveSeason(),
          metric_a: existingData.metric_a || '',
          metric_b: existingData.metric_b || '',
          metric_c: existingData.metric_c || '',
          rating: existingData.rating || '',
          league_tags: existingData.league_tags || []
        });
      } else {
        setFormData({
          sport_key: sportKey,
          season: getActiveSeason(),
          metric_a: '',
          metric_b: '',
          metric_c: '',
          rating: '',
          league_tags: []
        });
      }
      setErrors({});
    }
  }, [isOpen, existingData, sportKey]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.sport_key) {
      newErrors.sport_key = 'Please select a sport';
    }

    if (!formData.season.trim()) {
      newErrors.season = 'Season is required';
    }

    if (formData.rating) {
      const ratingStr = String(formData.rating).trim();
      const rating = Number(ratingStr);
      
      if (ratingStr === '' || isNaN(rating)) {
        newErrors.rating = 'Rating must be a valid number';
      } else if (rating < 0) {
        newErrors.rating = 'Rating cannot be below 0';
      } else if (rating > 100) {
        newErrors.rating = 'Rating cannot be above 100';
      } else if (!Number.isInteger(rating)) {
        newErrors.rating = 'Rating must be a whole number between 0 and 100';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) return;

    setSaving(true);
    try {
      const saveData: Partial<SeasonHighlight> = {
        sport_key: formData.sport_key,
        season: formData.season.trim(),
        metric_a: formData.metric_a.trim() || undefined,
        metric_b: formData.metric_b.trim() || undefined,
        metric_c: formData.metric_c.trim() || undefined,
        rating: formData.rating ? Number(formData.rating) : undefined,
        league_tags: formData.league_tags.length > 0 ? formData.league_tags : undefined,
      };

      await onSave(saveData);
      onClose();
    } catch {
      setErrors({ general: 'Failed to save highlights. Please try again.' });
    } finally {
      setSaving(false);
    }
  };

  const handleInputChange = (field: keyof FormData, value: string | number) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    // Clear field error when user starts typing
    if (errors[field]) {
      setErrors(prev => ({ ...prev, [field]: '' }));
    }
  };

  // Add league toggle handlers
  const handleLeagueToggle = (leagueKey: string) => {
    const newTags = formData.league_tags.includes(leagueKey)
      ? formData.league_tags.filter(tag => tag !== leagueKey)
      : [...formData.league_tags, leagueKey];
    
    // Limit to 2 leagues for UI consistency
    if (newTags.length <= 2) {
      setFormData(prev => ({ ...prev, league_tags: newTags }));
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                  <i className={`${sportConfig.icon} text-gray-600`}></i>
                </div>
                <h2 className="text-xl font-semibold text-gray-900">
                  Edit {sportConfig.displayName} ({getSeasonDisplayName()})
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 transition-colors"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
          </div>

          <div className="p-6 max-h-[60vh] overflow-y-auto">
            {errors.general && (
              <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded-md text-sm">
                {errors.general}
              </div>
            )}

            <div className="space-y-4">
              {/* Sport-specific Metrics */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {metrics.a}
                  </label>
                  <input
                    type="text"
                    value={formData.metric_a}
                    onChange={(e) => handleInputChange('metric_a', e.target.value)}
                    placeholder={`Enter ${metrics.a.toLowerCase()}`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {metrics.b}
                  </label>
                  <input
                    type="text"
                    value={formData.metric_b}
                    onChange={(e) => handleInputChange('metric_b', e.target.value)}
                    placeholder={`Enter ${metrics.b.toLowerCase()}`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {metrics.c}
                  </label>
                  <input
                    type="text"
                    value={formData.metric_c}
                    onChange={(e) => handleInputChange('metric_c', e.target.value)}
                    placeholder={`Enter ${metrics.c.toLowerCase()}`}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Overall Rating (0-100)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="1"
                    value={formData.rating}
                    onChange={(e) => handleInputChange('rating', e.target.value)}
                    placeholder="85"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                  {errors.rating && (
                    <p className="mt-1 text-sm text-red-600">{errors.rating}</p>
                  )}
                </div>
              </div>

              {/* League Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  League Affiliations (select up to 2)
                </label>
                <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto border border-gray-300 rounded-md p-3">
                  {LEAGUE_OPTIONS.map(league => (
                    <label
                      key={league.key}
                      className={`flex items-center p-2 rounded cursor-pointer transition-colors ${
                        formData.league_tags.includes(league.label)
                          ? 'bg-blue-100 border border-blue-300'
                          : 'hover:bg-gray-50 border border-transparent'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={formData.league_tags.includes(league.label)}
                        onChange={() => handleLeagueToggle(league.label)}
                        className="sr-only"
                      />
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded border-2 flex items-center justify-center ${
                          formData.league_tags.includes(league.label)
                            ? 'bg-blue-500 border-blue-500'
                            : 'border-gray-300'
                        }`}>
                          {formData.league_tags.includes(league.label) && (
                            <i className="fas fa-check text-white text-xs"></i>
                          )}
                        </div>
                        <span className="text-sm">{league.label}</span>
                      </div>
                    </label>
                  ))}
                </div>
                <p className="mt-1 text-xs text-gray-500">
                  Selected: {formData.league_tags.length}/2
                </p>
              </div>
            </div>
          </div>

          <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Saving...' : 'Save Highlights'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}