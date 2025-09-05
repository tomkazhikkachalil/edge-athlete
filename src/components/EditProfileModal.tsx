'use client';

import { useState, useRef, useEffect } from 'react';
import type { AthleteBadge, Profile } from '@/lib/supabase';

interface EditProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile | null;
  badges: AthleteBadge[];
  onSave: (updates: Partial<Profile>, badgeUpdates: AthleteBadge[]) => Promise<void>;
}

interface FormData {
  full_name?: string;
  username?: string;
  bio?: string;
  height_cm?: number;
  weight_display?: number;
  weight_unit?: 'lbs' | 'kg' | 'stone';
  dob?: string;
  location?: string;
  class_year?: string; // Keep as string for form handling
  social_twitter?: string;
  social_instagram?: string;
  social_facebook?: string;
}

export default function EditProfileModal({ isOpen, onClose, profile, badges, onSave }: EditProfileModalProps) {
  const [formData, setFormData] = useState<FormData>({});
  const [badgeData, setBadgeData] = useState<AthleteBadge[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'basic' | 'vitals' | 'socials' | 'badges'>('basic');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile) {
      setFormData({
        full_name: profile.full_name || '',
        username: profile.username || '',
        bio: profile.bio || '',
        height_cm: profile.height_cm || undefined,
        weight_display: profile.weight_display || undefined,
        weight_unit: profile.weight_unit || 'lbs',
        dob: profile.dob || '',
        location: profile.location || '',
        class_year: profile.class_year ? String(profile.class_year) : '',
        social_twitter: profile.social_twitter || '',
        social_instagram: profile.social_instagram || '',
        social_facebook: profile.social_facebook || '',
      });
    }
    setBadgeData([...badges]);
  }, [profile, badges]);

  const validateForm = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Height validation
    if (formData.height_cm !== undefined && formData.height_cm !== null) {
      if (formData.height_cm < 0 || formData.height_cm > 300) {
        newErrors.height_cm = 'Height must be between 0 and 300 cm';
      }
    }

    // Weight validation
    if (formData.weight_display !== undefined && formData.weight_display !== null) {
      const maxWeight = formData.weight_unit === 'kg' ? 500 : formData.weight_unit === 'stone' ? 80 : 1100;
      const minWeight = 0;
      if (formData.weight_display < minWeight || formData.weight_display > maxWeight) {
        const unitLabel = formData.weight_unit === 'kg' ? 'kg' : formData.weight_unit === 'stone' ? 'stone' : 'lbs';
        newErrors.weight_display = `Weight must be between ${minWeight} and ${maxWeight} ${unitLabel}`;
      }
    }

    // Date of birth validation
    if (formData.dob) {
      const birthDate = new Date(formData.dob);
      const today = new Date();
      const age = today.getFullYear() - birthDate.getFullYear();
      if (age < 5 || age > 100) {
        newErrors.dob = 'Please enter a valid date of birth';
      }
    }

    // Class year validation
    if (formData.class_year) {
      const year = parseInt(formData.class_year as string);
      if (isNaN(year) || year < 1900 || year > 2100) {
        newErrors.class_year = 'Please enter a valid 4-digit year';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateForm()) return;

    setSaving(true);
    try {
      // Clean social handles - remove @ and spaces
      const cleanedData = { ...formData };
      if (cleanedData.social_twitter) {
        cleanedData.social_twitter = cleanedData.social_twitter.replace(/^@+/, '').trim();
      }
      if (cleanedData.social_instagram) {
        cleanedData.social_instagram = cleanedData.social_instagram.replace(/^@+/, '').trim();
      }
      if (cleanedData.social_facebook) {
        cleanedData.social_facebook = cleanedData.social_facebook.replace(/^@+/, '').trim();
      }
      
      // Convert FormData to Profile format
      const profileData: Partial<Profile> = {
        full_name: cleanedData.full_name,
        username: cleanedData.username,
        bio: cleanedData.bio,
        height_cm: cleanedData.height_cm,
        weight_display: cleanedData.weight_display,
        weight_unit: cleanedData.weight_unit || 'lbs',
        dob: cleanedData.dob,
        location: cleanedData.location,
        class_year: cleanedData.class_year ? parseInt(cleanedData.class_year) : undefined,
        social_twitter: cleanedData.social_twitter,
        social_instagram: cleanedData.social_instagram,
        social_facebook: cleanedData.social_facebook,
      };

      await onSave(profileData, badgeData);
      onClose();
    } catch {
      setErrors({ general: 'Failed to save changes. Please try again.' });
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

  const addBadge = () => {
    const newBadge: AthleteBadge = {
      id: `temp_${Date.now()}`,
      profile_id: profile?.id || '',
      label: '',
      color_token: 'primary',
      icon_url: '',
      position: badgeData.length,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    setBadgeData(prev => [...prev, newBadge]);
  };

  const updateBadge = (index: number, updates: Partial<AthleteBadge>) => {
    setBadgeData(prev => prev.map((badge, i) => 
      i === index ? { ...badge, ...updates } : badge
    ));
  };

  const removeBadge = (index: number) => {
    setBadgeData(prev => prev.filter((_, i) => i !== index));
  };

  const moveBadge = (from: number, to: number) => {
    setBadgeData(prev => {
      const newBadges = [...prev];
      const [movedBadge] = newBadges.splice(from, 1);
      newBadges.splice(to, 0, movedBadge);
      return newBadges.map((badge, index) => ({ ...badge, position: index }));
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-hidden">
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">Edit Profile</h2>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-500 transition-colors"
            >
              <i className="fas fa-times text-xl"></i>
            </button>
          </div>
          
          {/* Tab Navigation */}
          <div className="flex space-x-4 mt-4">
            {[
              { key: 'basic', label: 'Basic', icon: 'fas fa-user' },
              { key: 'vitals', label: 'Vitals', icon: 'fas fa-chart-line' },
              { key: 'socials', label: 'Socials', icon: 'fas fa-share-alt' },
              { key: 'badges', label: 'Badges', icon: 'fas fa-award' },
            ].map(tab => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key as 'basic' | 'vitals' | 'socials' | 'badges')}
                className={`px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                  activeTab === tab.key
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <i className={`${tab.icon} mr-1`}></i>
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6 max-h-[60vh] overflow-y-auto">
          {errors.general && (
            <div className="mb-4 p-3 bg-red-100 border border-red-300 text-red-700 rounded-md">
              {errors.general}
            </div>
          )}

          {/* Basic Tab */}
          {activeTab === 'basic' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Full Name
                </label>
                <input
                  type="text"
                  value={formData.full_name || ''}
                  onChange={(e) => handleInputChange('full_name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your full name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={formData.username || ''}
                  onChange={(e) => handleInputChange('username', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your username"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bio
                </label>
                <textarea
                  value={formData.bio || ''}
                  onChange={(e) => handleInputChange('bio', e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Tell us about yourself"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Avatar
                </label>
                <div className="flex items-center space-x-4">
                  <div className="w-16 h-16 rounded-full bg-gray-200 flex items-center justify-center">
                    {profile?.avatar_url ? (
                      <img src={profile.avatar_url} alt="" className="w-16 h-16 rounded-full object-cover" />
                    ) : (
                      <i className="fas fa-user text-gray-400 text-xl"></i>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50"
                  >
                    Upload Image
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={() => {
                      // TODO: Implement avatar upload
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Vitals Tab */}
          {activeTab === 'vitals' && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Height (cm)
                  </label>
                  <input
                    type="number"
                    value={formData.height_cm || ''}
                    onChange={(e) => handleInputChange('height_cm', parseFloat(e.target.value) || 0)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="170"
                    min="0"
                    max="300"
                  />
                  {errors.height_cm && (
                    <p className="mt-1 text-sm text-red-600">{errors.height_cm}</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Weight
                  </label>
                  <div className="flex space-x-2">
                    <input
                      type="number"
                      step="0.1"
                      value={formData.weight_display || ''}
                      onChange={(e) => handleInputChange('weight_display', parseFloat(e.target.value) || 0)}
                      className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      placeholder={formData.weight_unit === 'kg' ? '68' : formData.weight_unit === 'stone' ? '11.7' : '150'}
                      min="0"
                      max={formData.weight_unit === 'kg' ? 500 : formData.weight_unit === 'stone' ? 80 : 1100}
                    />
                    <select
                      value={formData.weight_unit || 'lbs'}
                      onChange={(e) => handleInputChange('weight_unit', e.target.value)}
                      className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    >
                      <option value="lbs">lbs</option>
                      <option value="kg">kg</option>
                      <option value="stone">stone</option>
                    </select>
                  </div>
                  {errors.weight_display && (
                    <p className="mt-1 text-sm text-red-600">{errors.weight_display}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-500">
                    {formData.weight_unit === 'stone' ? 'Enter as stone.pounds (e.g., 11.7 = 11 stone 7 lbs)' : 
                     formData.weight_unit === 'kg' ? 'Enter weight in kilograms' : 
                     'Enter weight in pounds'}
                  </p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Date of Birth
                </label>
                <input
                  type="date"
                  value={formData.dob || ''}
                  onChange={(e) => handleInputChange('dob', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
                {errors.dob && (
                  <p className="mt-1 text-sm text-red-600">{errors.dob}</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={formData.location || ''}
                  onChange={(e) => handleInputChange('location', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="City, State"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Class Year
                </label>
                <input
                  type="text"
                  value={formData.class_year || ''}
                  onChange={(e) => handleInputChange('class_year', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="2025"
                  pattern="[0-9]{4}"
                />
                {errors.class_year && (
                  <p className="mt-1 text-sm text-red-600">{errors.class_year}</p>
                )}
              </div>
            </div>
          )}

          {/* Socials Tab */}
          {activeTab === 'socials' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Twitter Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">@</span>
                  <input
                    type="text"
                    value={formData.social_twitter || ''}
                    onChange={(e) => handleInputChange('social_twitter', e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Instagram Handle
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500">@</span>
                  <input
                    type="text"
                    value={formData.social_instagram || ''}
                    onChange={(e) => handleInputChange('social_instagram', e.target.value)}
                    className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    placeholder="username"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Facebook Profile
                </label>
                <input
                  type="text"
                  value={formData.social_facebook || ''}
                  onChange={(e) => handleInputChange('social_facebook', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Full name or username"
                />
              </div>
            </div>
          )}

          {/* Badges Tab */}
          {activeTab === 'badges' && (
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="text-sm font-medium text-gray-700">Manage Badges</h3>
                <button
                  type="button"
                  onClick={addBadge}
                  className="px-3 py-1 text-sm font-medium text-blue-600 border border-blue-600 rounded-md hover:bg-blue-50"
                >
                  <i className="fas fa-plus mr-1"></i>
                  Add Badge
                </button>
              </div>

              <div className="space-y-3">
                {badgeData.map((badge, index) => (
                  <div key={badge.id} className="p-3 border border-gray-200 rounded-md">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-4">
                        <input
                          type="text"
                          value={badge.label}
                          onChange={(e) => updateBadge(index, { label: e.target.value })}
                          placeholder="Badge name"
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-3">
                        <select
                          value={badge.color_token}
                          onChange={(e) => updateBadge(index, { color_token: e.target.value })}
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        >
                          <option value="primary">Blue</option>
                          <option value="green">Green</option>
                          <option value="red">Red</option>
                          <option value="yellow">Yellow</option>
                          <option value="purple">Purple</option>
                          <option value="gray">Gray</option>
                        </select>
                      </div>
                      <div className="col-span-3">
                        <input
                          type="url"
                          value={badge.icon_url || ''}
                          onChange={(e) => updateBadge(index, { icon_url: e.target.value })}
                          placeholder="Icon URL"
                          className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-2 flex items-center space-x-1">
                        {index > 0 && (
                          <button
                            type="button"
                            onClick={() => moveBadge(index, index - 1)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <i className="fas fa-arrow-up"></i>
                          </button>
                        )}
                        {index < badgeData.length - 1 && (
                          <button
                            type="button"
                            onClick={() => moveBadge(index, index + 1)}
                            className="p-1 text-gray-400 hover:text-gray-600"
                          >
                            <i className="fas fa-arrow-down"></i>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => removeBadge(index)}
                          className="p-1 text-red-400 hover:text-red-600"
                        >
                          <i className="fas fa-trash"></i>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="p-6 border-t border-gray-200 flex justify-end space-x-3">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 border border-transparent rounded-md hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
}