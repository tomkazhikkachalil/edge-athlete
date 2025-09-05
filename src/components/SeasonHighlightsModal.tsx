'use client';

import { useState, useEffect } from 'react';
import type { SeasonHighlight } from '@/lib/supabase';

interface SeasonHighlightsModalProps {
  isOpen: boolean;
  onClose: () => void;
  sportKey: string;
  existingData?: SeasonHighlight;
  onSave: (data: Partial<SeasonHighlight>) => Promise<void>;
}

const SPORTS_OPTIONS = [
  { key: 'hockey', label: 'Hockey', icon: 'fas fa-hockey-puck' },
  { key: 'volleyball', label: 'Volleyball', icon: 'fas fa-volleyball-ball' },
  { key: 'track-field', label: 'Track & Field', icon: 'fas fa-running' },
  { key: 'basketball', label: 'Basketball', icon: 'fas fa-basketball-ball' },
  { key: 'soccer', label: 'Soccer', icon: 'fas fa-futbol' },
  { key: 'tennis', label: 'Tennis', icon: 'fas fa-table-tennis' },
  { key: 'swimming', label: 'Swimming', icon: 'fas fa-swimmer' },
  { key: 'baseball', label: 'Baseball', icon: 'fas fa-baseball-ball' },
];

interface FormData {
  sport_key: string;
  season: string;
  metric_a: string;
  metric_b: string;
  metric_c: string;
  rating: number | string;
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
    rating: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Get current season
  const getCurrentSeason = () => {
    const year = new Date().getFullYear();
    return `${year}-${String(year + 1).slice(-2)}`;
  };

  useEffect(() => {
    if (isOpen) {
      if (existingData) {
        setFormData({
          sport_key: existingData.sport_key,
          season: existingData.season || getCurrentSeason(),
          metric_a: existingData.metric_a || '',
          metric_b: existingData.metric_b || '',
          metric_c: existingData.metric_c || '',
          rating: existingData.rating || ''
        });
      } else {
        setFormData({
          sport_key: sportKey,
          season: getCurrentSeason(),
          metric_a: '',
          metric_b: '',
          metric_c: '',
          rating: ''
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
      const rating = Number(formData.rating);
      if (isNaN(rating) || rating < 0 || rating > 100) {
        newErrors.rating = 'Rating must be a number between 0 and 100';
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

  const selectedSport = SPORTS_OPTIONS.find(sport => sport.key === formData.sport_key);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                {selectedSport && (
                  <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center">
                    <i className={`${selectedSport.icon} text-gray-600`}></i>
                  </div>
                )}
                <h2 className="text-xl font-semibold text-gray-900">
                  Season Highlights
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
              {/* Sport Selection */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Sport
                </label>
                <select
                  value={formData.sport_key}
                  onChange={(e) => handleInputChange('sport_key', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select a sport</option>
                  {SPORTS_OPTIONS.map(sport => (
                    <option key={sport.key} value={sport.key}>
                      {sport.label}
                    </option>
                  ))}
                </select>
                {errors.sport_key && (
                  <p className="mt-1 text-sm text-red-600">{errors.sport_key}</p>
                )}
              </div>

              {/* Season */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Season
                </label>
                <input
                  type="text"
                  value={formData.season}
                  onChange={(e) => handleInputChange('season', e.target.value)}
                  placeholder="e.g., 2024-25"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.season && (
                  <p className="mt-1 text-sm text-red-600">{errors.season}</p>
                )}
              </div>

              {/* Metrics */}
              <div className="grid grid-cols-1 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Metric A
                  </label>
                  <input
                    type="text"
                    value={formData.metric_a}
                    onChange={(e) => handleInputChange('metric_a', e.target.value)}
                    placeholder="e.g., Goals: 15"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Metric B
                  </label>
                  <input
                    type="text"
                    value={formData.metric_b}
                    onChange={(e) => handleInputChange('metric_b', e.target.value)}
                    placeholder="e.g., Assists: 8"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Metric C
                  </label>
                  <input
                    type="text"
                    value={formData.metric_c}
                    onChange={(e) => handleInputChange('metric_c', e.target.value)}
                    placeholder="e.g., Games: 22"
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