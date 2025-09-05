'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from './Toast';
import LazyImage from './LazyImage';
import type { Profile, AthleteBadge, SeasonHighlight, Performance } from '@/lib/supabase';
import { 
  formatHeight, 
  formatDisplayName,
  getInitials,
  formatSocialHandle,
  validateHeight
} from '@/lib/formatters';

interface EditProfileTabsProps {
  isOpen: boolean;
  onClose: () => void;
  profile: Profile | null;
  badges: AthleteBadge[];
  highlights: SeasonHighlight[];
  performances: Performance[];
  onSave: () => void;
}

type TabId = 'basic' | 'vitals' | 'socials' | 'badges' | 'sports' | 'performances';

interface TabConfig {
  id: TabId;
  label: string;
  icon: string;
}

const TABS: TabConfig[] = [
  { id: 'basic', label: 'Basic', icon: 'fas fa-user' },
  { id: 'vitals', label: 'Vitals', icon: 'fas fa-chart-line' },
  { id: 'socials', label: 'Socials', icon: 'fas fa-share-alt' },
  { id: 'badges', label: 'Badges', icon: 'fas fa-award' },
  { id: 'sports', label: 'Sports & Highlights', icon: 'fas fa-trophy' },
  { id: 'performances', label: 'Performances', icon: 'fas fa-list' },
];

export default function EditProfileTabs({
  isOpen,
  onClose,
  profile,
  badges: _badges, // eslint-disable-line @typescript-eslint/no-unused-vars
  highlights: _highlights, // eslint-disable-line @typescript-eslint/no-unused-vars
  performances: _performances, // eslint-disable-line @typescript-eslint/no-unused-vars
  onSave
}: EditProfileTabsProps) {
  const { user } = useAuth();
  const { showSuccess, showError, showInfo } = useToast();
  const [activeTab, setActiveTab] = useState<TabId>('basic');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Form states - Initialize with empty strings to prevent controlled/uncontrolled warnings
  const [basicForm, setBasicForm] = useState({
    full_name: '',
    username: '',
    bio: '',
    avatar_file: null as File | null,
  });

  const [vitalsForm, setVitalsForm] = useState({
    height_cm: '',
    weight_kg: '',
    weight_unit: 'lbs' as 'lbs' | 'kg' | 'stone',
    dob: '',
    location: '',
    class_year: '' as string | number,
  });

  const [socialsForm, setSocialsForm] = useState({
    social_twitter: '',
    social_instagram: '',
    social_facebook: '',
  });

  // No conversion - save exactly what user enters

  // Initialize forms when profile changes
  useEffect(() => {
    const displayName = profile ? formatDisplayName(profile.full_name, profile.first_name, profile.last_name) : '';
    
    setBasicForm({
      full_name: (profile?.full_name || displayName || '').toString(),
      username: (profile?.username || '').toString(),
      bio: (profile?.bio || '').toString(),
      avatar_file: null,
    });

    // Initialize weight with user's saved values - no conversion
    const savedUnit = (profile?.weight_unit || 'lbs') as 'lbs' | 'kg' | 'stone';
    setVitalsForm({
      height_cm: profile?.height_cm ? formatHeight(profile.height_cm) : '',
      weight_kg: profile?.weight_display ? String(profile.weight_display) : '',
      weight_unit: savedUnit,
      dob: (profile?.dob || '').toString(),
      location: (profile?.location || '').toString(),
      class_year: profile?.class_year ? String(profile.class_year) : '',
    });

    setSocialsForm({
      social_twitter: formatSocialHandle(profile?.social_twitter),
      social_instagram: formatSocialHandle(profile?.social_instagram),
      social_facebook: formatSocialHandle(profile?.social_facebook),
    });
  }, [profile]);

  const saveTab = async (tabId: TabId) => {
    if (!user?.id) {
      showError('Authentication Error', 'Please log in again.');
      return;
    }

    setIsSubmitting(true);
    setErrors({});

    try {
      let updateData: Partial<Profile> = {};
      let hasChanges = false;

      switch (tabId) {
        case 'basic':
          // Handle avatar upload if present
          if (basicForm.avatar_file) {
            await uploadAvatar(basicForm.avatar_file);
          }
          
          updateData = {
            full_name: basicForm.full_name.trim() || undefined,
            username: basicForm.username.trim() || undefined,
            bio: basicForm.bio.trim() || undefined,
          };
          hasChanges = true;
          break;

        case 'vitals':
          console.log('Vitals form data before save:', vitalsForm);
          // Validate height
          const heightValidation = validateHeight(vitalsForm.height_cm);
          if (vitalsForm.height_cm.trim() && heightValidation.error) {
            throw new Error(`Height: ${heightValidation.error}`);
          }
          
          // Save weight display value exactly as entered
          let weightDisplay: number | undefined;
          if (vitalsForm.weight_kg && vitalsForm.weight_kg.trim()) {
            weightDisplay = parseFloat(vitalsForm.weight_kg);
            console.log('Weight save:', {
              input: vitalsForm.weight_kg,
              unit: vitalsForm.weight_unit,
              displayValue: weightDisplay
            });
            if (isNaN(weightDisplay) || weightDisplay <= 0) {
              throw new Error(`Please enter a valid weight`);
            }
          } else {
            console.log('No weight entered, will clear weight_display');
            weightDisplay = undefined;
          }
          
          updateData = {
            height_cm: heightValidation.value || undefined,
            weight_display: weightDisplay,
            weight_unit: vitalsForm.weight_unit || 'lbs',
            dob: vitalsForm.dob || undefined,
            location: vitalsForm.location.trim() || undefined,
            class_year: vitalsForm.class_year ? parseInt(String(vitalsForm.class_year)) : undefined,
          };
          console.log('Vitals update data:', updateData);
          hasChanges = true;
          break;

        case 'socials':
          updateData = {
            social_twitter: socialsForm.social_twitter.trim() || undefined,
            social_instagram: socialsForm.social_instagram.trim() || undefined,
            social_facebook: socialsForm.social_facebook.trim() || undefined,
          };
          hasChanges = true;
          break;

        case 'badges':
          // TODO: Implement badge updates
          showInfo('Badges', 'Badge management coming soon!');
          return;

        case 'sports':
          // TODO: Implement sports/highlights updates
          showInfo('Sports & Highlights', 'Sports management coming soon!');
          return;

        case 'performances':
          // TODO: Implement performances updates
          showInfo('Performances', 'Performance management coming soon!');
          return;
      }

      if (hasChanges) {
        const response = await fetch('/api/profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            profileData: updateData,
            userId: user.id
          }),
        });

        if (!response.ok) {
          const error = await response.json();
          throw new Error(error.error || 'Failed to save changes');
        }

        const result = await response.json();
        console.log('Save response:', result);
        
        showSuccess('Changes Saved', `${TABS.find(t => t.id === tabId)?.label} updated successfully!`);
        onSave(); // Refresh parent data
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save changes';
      showError('Save Failed', message);
      
      // Set field-specific errors if needed
      if (message.includes('username')) {
        setErrors({ username: message });
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    const maxSize = 5 * 1024 * 1024; // 5MB
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    
    if (file.size > maxSize) {
      throw new Error('Avatar file size must be less than 5MB');
    }
    
    if (!allowedTypes.includes(file.type)) {
      throw new Error('Please select a valid image file (JPG, PNG, GIF, or WebP)');
    }

    const formData = new FormData();
    formData.append('avatar', file);
    formData.append('userId', user!.id);

    const response = await fetch('/api/upload/avatar', {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const result = await response.json();
      throw new Error(result.error || 'Failed to upload avatar');
    }
  };

  const renderBasicTab = () => (
    <div className="space-y-6">
      {/* Avatar Upload */}
      <div className="flex items-center space-x-4">
        <div className="relative">
          <LazyImage
            src={profile?.avatar_url}
            alt={`${basicForm.full_name || 'User'} avatar`}
            className="w-20 h-20 rounded-full object-cover border-3 border-gray-300"
            width={80}
            height={80}
            priority
            fallback={
              <div 
                className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center border-3 border-gray-300"
                role="img"
                aria-label={`${basicForm.full_name || 'User'} avatar`}
              >
                <span className="text-gray-600 font-semibold text-xl" aria-hidden="true">
                  {getInitials(basicForm.full_name)}
                </span>
              </div>
            }
          />
        </div>
        <div className="flex-1">
          <label
            htmlFor="avatar-upload"
            className="cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            <i className="fas fa-upload mr-2" aria-hidden="true"></i>
            Change Avatar
          </label>
          <input
            key={`avatar-upload-${isOpen}`}
            id="avatar-upload"
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                setBasicForm(prev => ({ ...prev, avatar_file: file }));
              }
              // Reset the input value to allow re-selecting the same file
              e.target.value = '';
            }}
          />
          <p className="mt-1 text-xs text-gray-500">
            JPG, PNG, GIF or WebP. Max 5MB.
          </p>
        </div>
      </div>

      {/* Name Fields */}
      <div>
        <label htmlFor="full_name" className="block text-sm font-medium text-gray-700 mb-1">
          Full Name
        </label>
        <input
          id="full_name"
          type="text"
          value={basicForm.full_name || ''}
          onChange={(e) => setBasicForm(prev => ({ ...prev, full_name: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="Enter your full name"
        />
      </div>

      <div>
        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
          Username
        </label>
        <input
          id="username"
          type="text"
          value={basicForm.username || ''}
          onChange={(e) => setBasicForm(prev => ({ ...prev, username: e.target.value }))}
          className={`w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
            errors.username ? 'border-red-500' : 'border-gray-300'
          }`}
          placeholder="Enter a unique username"
        />
        {errors.username && (
          <p className="mt-1 text-sm text-red-600" role="alert">
            {errors.username}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="bio" className="block text-sm font-medium text-gray-700 mb-1">
          Bio
        </label>
        <textarea
          id="bio"
          rows={4}
          value={basicForm.bio || ''}
          onChange={(e) => setBasicForm(prev => ({ ...prev, bio: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
          placeholder="Tell us about yourself..."
        />
        <p className="mt-1 text-xs text-gray-500">
          {basicForm.bio.length}/500 characters
        </p>
      </div>
    </div>
  );

  const renderVitalsTab = () => (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label htmlFor="height" className="block text-sm font-medium text-gray-700 mb-1">
            Height
          </label>
          <input
            id="height"
            type="text"
            value={vitalsForm.height_cm || ''}
            onChange={(e) => setVitalsForm(prev => ({ ...prev, height_cm: e.target.value }))}
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="5'10&quot;, 5 10, 510, or 5.10"
          />
          <p className="mt-1 text-xs text-gray-500">
            Multiple formats accepted: 5&apos;10&quot;, 5 10, 510, 5.10, 6 feet
          </p>
        </div>

        <div>
          <label htmlFor="weight" className="block text-sm font-medium text-gray-700 mb-1">
            Weight
          </label>
          <div className="flex space-x-2">
            <input
              id="weight"
              type="number"
              step="0.1"
              value={vitalsForm.weight_kg || ''}
              onChange={(e) => setVitalsForm(prev => ({ ...prev, weight_kg: e.target.value }))}
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder={vitalsForm.weight_unit === 'kg' ? '68' : vitalsForm.weight_unit === 'stone' ? '11.7' : '150'}
            />
            <select
              value={vitalsForm.weight_unit}
              onChange={(e) => {
                const newUnit = e.target.value as 'lbs' | 'kg' | 'stone';
                // Just change the unit, don't convert the value
                setVitalsForm(prev => ({ 
                  ...prev, 
                  weight_unit: newUnit
                }));
              }}
              className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
              <option value="stone">stone</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            {vitalsForm.weight_unit === 'stone' ? 'Enter as stone.pounds (e.g., 11.7 = 11 stone 7 lbs)' : 
             vitalsForm.weight_unit === 'kg' ? 'Enter weight in kilograms' : 
             'Enter weight in pounds'}
          </p>
        </div>
      </div>

      <div>
        <label htmlFor="dob" className="block text-sm font-medium text-gray-700 mb-1">
          Date of Birth
        </label>
        <input
          id="dob"
          type="date"
          value={vitalsForm.dob || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, dob: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>

      <div>
        <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-1">
          Location
        </label>
        <input
          id="location"
          type="text"
          value={vitalsForm.location || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, location: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="City, State"
        />
      </div>

      <div>
        <label htmlFor="class_year" className="block text-sm font-medium text-gray-700 mb-1">
          Class Year
        </label>
        <input
          id="class_year"
          type="number"
          min="2020"
          max="2040"
          value={vitalsForm.class_year || ''}
          onChange={(e) => setVitalsForm(prev => ({ ...prev, class_year: e.target.value }))}
          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          placeholder="2025"
        />
      </div>
    </div>
  );

  const renderSocialsTab = () => (
    <div className="space-y-6">
      <div>
        <label htmlFor="twitter" className="block text-sm font-medium text-gray-700 mb-1">
          <i className="fab fa-twitter text-blue-400 mr-2" aria-hidden="true"></i>
          Twitter Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">@</span>
          <input
            id="twitter"
            type="text"
            value={socialsForm.social_twitter || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_twitter: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>

      <div>
        <label htmlFor="instagram" className="block text-sm font-medium text-gray-700 mb-1">
          <i className="fab fa-instagram text-pink-500 mr-2" aria-hidden="true"></i>
          Instagram Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">@</span>
          <input
            id="instagram"
            type="text"
            value={socialsForm.social_instagram || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_instagram: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>

      <div>
        <label htmlFor="facebook" className="block text-sm font-medium text-gray-700 mb-1">
          <i className="fab fa-facebook text-blue-600 mr-2" aria-hidden="true"></i>
          Facebook Handle
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-500 text-sm">@</span>
          <input
            id="facebook"
            type="text"
            value={socialsForm.social_facebook || ''}
            onChange={(e) => setSocialsForm(prev => ({ ...prev, social_facebook: e.target.value }))}
            className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            placeholder="username"
          />
        </div>
      </div>
    </div>
  );

  const renderTabContent = () => {
    switch (activeTab) {
      case 'basic':
        return renderBasicTab();
      case 'vitals':
        return renderVitalsTab();
      case 'socials':
        return renderSocialsTab();
      case 'badges':
        return (
          <div className="text-center py-12 text-gray-500">
            <i className="fas fa-award text-4xl text-gray-300 mb-4" aria-hidden="true"></i>
            <h3 className="text-lg font-medium mb-2">Badge Management</h3>
            <p>Badge ordering and management features coming soon!</p>
          </div>
        );
      case 'sports':
        return (
          <div className="text-center py-12 text-gray-500">
            <i className="fas fa-trophy text-4xl text-gray-300 mb-4" aria-hidden="true"></i>
            <h3 className="text-lg font-medium mb-2">Sports & Season Highlights</h3>
            <p>Sports selection and season metrics management coming soon!</p>
          </div>
        );
      case 'performances':
        return (
          <div className="text-center py-12 text-gray-500">
            <i className="fas fa-list text-4xl text-gray-300 mb-4" aria-hidden="true"></i>
            <h3 className="text-lg font-medium mb-2">Performance Management</h3>
            <p>Add, edit, and delete performance records coming soon!</p>
          </div>
        );
      default:
        return null;
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto" aria-labelledby="edit-profile-title" role="dialog" aria-modal="true">
      <div className="flex items-center justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        {/* Backdrop */}
        <div 
          className="fixed inset-0 bg-gray-500 bg-opacity-75 transition-opacity" 
          aria-hidden="true"
          onClick={onClose}
        ></div>

        {/* Modal */}
        <div className="inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
          {/* Header */}
          <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
            <div className="flex items-center justify-between mb-6">
              <h2 id="edit-profile-title" className="text-lg font-medium text-gray-900">
                Edit Profile
              </h2>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-md p-1"
                aria-label="Close modal"
              >
                <i className="fas fa-times text-lg" aria-hidden="true"></i>
              </button>
            </div>

            {/* Tabs */}
            <div className="border-b border-gray-200">
              <nav className="-mb-px flex space-x-8" aria-label="Profile sections">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`py-2 px-1 border-b-2 font-medium text-sm whitespace-nowrap focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                      activeTab === tab.id
                        ? 'border-blue-500 text-blue-600'
                        : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                    }`}
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                  >
                    <i className={`${tab.icon} mr-2`} aria-hidden="true"></i>
                    {tab.label}
                  </button>
                ))}
              </nav>
            </div>
          </div>

          {/* Tab Content */}
          <div className="bg-gray-50 px-4 py-6 sm:px-6">
            <div className="max-h-96 overflow-y-auto">
              {renderTabContent()}
            </div>
          </div>

          {/* Footer */}
          <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
            <button
              onClick={() => saveTab(activeTab)}
              disabled={isSubmitting}
              className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-blue-600 text-base font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? (
                <>
                  <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
                  Saving...
                </>
              ) : (
                <>
                  <i className="fas fa-save mr-2" aria-hidden="true"></i>
                  Save {TABS.find(t => t.id === activeTab)?.label}
                </>
              )}
            </button>
            <button
              onClick={onClose}
              className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}