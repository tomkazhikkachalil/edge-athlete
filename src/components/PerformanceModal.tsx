'use client';

import { useState, useEffect } from 'react';
import type { Performance } from '@/lib/supabase';

interface PerformanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingData?: Performance;
  onSave: (data: Partial<Performance>) => Promise<void>;
}

interface FormData {
  date: string;
  event: string;
  result_place: string;
  stat_primary: string;
  organization: string;
  athletic_score: number | string;
}

export default function PerformanceModal({
  isOpen,
  onClose,
  existingData,
  onSave
}: PerformanceModalProps) {
  const [formData, setFormData] = useState<FormData>({
    date: '',
    event: '',
    result_place: '',
    stat_primary: '',
    organization: '',
    athletic_score: ''
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (existingData) {
        // Format the date for input field (YYYY-MM-DD)
        const formattedDate = existingData.date ? new Date(existingData.date).toISOString().split('T')[0] : '';
        
        setFormData({
          date: formattedDate,
          event: existingData.event || '',
          result_place: existingData.result_place || '',
          stat_primary: existingData.stat_primary || '',
          organization: existingData.organization || '',
          athletic_score: existingData.athletic_score || ''
        });
      } else {
        setFormData({
          date: '',
          event: '',
          result_place: '',
          stat_primary: '',
          organization: '',
          athletic_score: ''
        });
      }
      setErrors({});
    }
  }, [isOpen, existingData]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.date.trim()) {
      newErrors.date = 'Date is required';
    }

    if (!formData.event.trim()) {
      newErrors.event = 'Event is required';
    }

    if (formData.athletic_score) {
      const scoreStr = String(formData.athletic_score).trim();
      const score = Number(scoreStr);
      
      if (scoreStr === '' || isNaN(score)) {
        newErrors.athletic_score = 'Athletic score must be a valid number';
      } else if (score < 0) {
        newErrors.athletic_score = 'Athletic score cannot be below 0';
      } else if (score > 100) {
        newErrors.athletic_score = 'Athletic score cannot be above 100';
      } else if (!Number.isInteger(score)) {
        newErrors.athletic_score = 'Athletic score must be a whole number between 0 and 100';
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
      const saveData: Partial<Performance> = {
        id: existingData?.id, // Include ID for updates
        date: formData.date.trim(),
        event: formData.event.trim(),
        result_place: formData.result_place.trim() || undefined,
        stat_primary: formData.stat_primary.trim() || undefined,
        organization: formData.organization.trim() || undefined,
        athletic_score: formData.athletic_score ? Number(formData.athletic_score) : undefined,
      };

      await onSave(saveData);
      onClose();
    } catch {
      setErrors({ general: 'Failed to save performance. Please try again.' });
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-md w-full max-h-[90vh] overflow-hidden">
        <form onSubmit={handleSubmit}>
          <div className="p-6 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-gray-900">
                {existingData ? 'Edit Performance' : 'Add Performance'}
              </h2>
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
              {/* Date - Required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Date <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={formData.date}
                  onChange={(e) => handleInputChange('date', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.date && (
                  <p className="mt-1 text-sm text-red-600">{errors.date}</p>
                )}
              </div>

              {/* Event - Required */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Event <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formData.event}
                  onChange={(e) => handleInputChange('event', e.target.value)}
                  placeholder="e.g., 100m Freestyle, Shot Put, Marathon"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.event && (
                  <p className="mt-1 text-sm text-red-600">{errors.event}</p>
                )}
              </div>

              {/* Result (Place) - Optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Result (Place)
                </label>
                <input
                  type="text"
                  value={formData.result_place}
                  onChange={(e) => handleInputChange('result_place', e.target.value)}
                  placeholder="e.g., 1st, 3rd, DNF, PR"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Stat (Primary) - Optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Stat (Primary)
                </label>
                <input
                  type="text"
                  value={formData.stat_primary}
                  onChange={(e) => handleInputChange('stat_primary', e.target.value)}
                  placeholder="e.g., 12.45s, 15.2m, 2:45:30"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Organization - Optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Organization
                </label>
                <input
                  type="text"
                  value={formData.organization}
                  onChange={(e) => handleInputChange('organization', e.target.value)}
                  placeholder="e.g., NCAA, USATF, High School"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Athletic Score (0-100) - Optional */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Athletic Score (0-100)
                </label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="1"
                  value={formData.athletic_score}
                  onChange={(e) => handleInputChange('athletic_score', e.target.value)}
                  placeholder="85"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.athletic_score && (
                  <p className="mt-1 text-sm text-red-600">{errors.athletic_score}</p>
                )}
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
              {saving ? 'Saving...' : existingData ? 'Update Performance' : 'Add Performance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}