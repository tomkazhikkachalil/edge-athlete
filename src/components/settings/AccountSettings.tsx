'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import DeleteAccountModal from './DeleteAccountModal';
import { formatDisplayName, formatHeight } from '@/lib/formatters';

interface AccountSettingsProps {
  onEditProfile?: () => void;
}

export default function AccountSettings({ onEditProfile }: AccountSettingsProps) {
  const { profile } = useAuth();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);

  return (
    <div className="space-y-8">
      {/* Profile Information Section */}
      <div>
        <div className="mb-6">
          <h3 className="text-2xl font-bold text-gray-900 tracking-tight">Profile Information</h3>
          <p className="text-sm text-gray-500 mt-1">View your account details and personal information</p>
        </div>
        <div className="bg-white rounded-xl p-6 sm:p-8 border border-gray-200 shadow-sm">
          {/* Basic Info */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                <i className="fas fa-user text-blue-600 text-lg"></i>
              </div>
              <h4 className="text-lg font-bold text-gray-900 tracking-tight">Basic Information</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Full Name
                </label>
                <p className="text-base font-medium text-gray-900">
                  {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name) || (
                    <span className="text-gray-400 italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Handle
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.handle ? `@${profile.handle}` : profile?.full_name ? `@${profile.full_name}` : (
                    <span className="text-gray-400 italic">Not set</span>
                  )}
                </p>
                {!profile?.handle && profile?.full_name && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <i className="fas fa-exclamation-triangle"></i>
                    Using legacy username. Update to new handle format.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <p className="text-base font-medium text-gray-900">{profile?.email || (
                  <span className="text-gray-400 italic">Not set</span>
                )}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Account Type
                </label>
                <p className="text-base font-medium text-gray-900 capitalize">{profile?.user_type || 'Athlete'}</p>
              </div>
            </div>
          </div>

          {/* Vitals */}
          <div className="pt-8 border-t border-gray-200">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
                <i className="fas fa-chart-line text-purple-600 text-lg"></i>
              </div>
              <h4 className="text-lg font-bold text-gray-900 tracking-tight">Vitals & Details</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Height
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.height_cm ? formatHeight(profile.height_cm) : (
                    <span className="text-gray-400 italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Weight
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.weight_display
                    ? `${profile.weight_display} ${profile.weight_unit || 'lbs'}`
                    : <span className="text-gray-400 italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Date of Birth
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.dob
                    ? new Date(profile.dob).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                    : <span className="text-gray-400 italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Location
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.location || <span className="text-gray-400 italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Class Year
                </label>
                <p className="text-base font-medium text-gray-900">
                  {profile?.class_year || <span className="text-gray-400 italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                  Profile Visibility
                </label>
                <div className="mt-1">
                  <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                    profile?.visibility === 'public'
                      ? 'bg-green-50 text-green-700 border border-green-200'
                      : 'bg-orange-50 text-orange-700 border border-orange-200'
                  }`}>
                    <i className={`fas fa-${profile?.visibility === 'public' ? 'globe' : 'lock'}`}></i>
                    {profile?.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-8 pt-6 border-t border-gray-200">
            <button
              onClick={() => {
                if (onEditProfile) {
                  onEditProfile();
                } else {
                  window.location.href = '/athlete';
                }
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-sm"
            >
              <i className="fas fa-edit"></i>
              Edit Profile Details
            </button>
          </div>
        </div>
      </div>

      {/* Danger Zone Section */}
      <div className="border-t border-gray-200 pt-8">
        <div className="bg-red-50 border-2 border-red-200 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <i className="fas fa-exclamation-triangle text-red-600 text-xl"></i>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-900 mb-2">Danger Zone</h3>
              <p className="text-red-800 text-sm mb-4">
                Once you delete your account, there is no going back. Please be certain.
              </p>
              <button
                onClick={() => setIsDeleteModalOpen(true)}
                className="bg-red-600 text-white px-6 py-2.5 rounded-lg hover:bg-red-700 transition-colors font-medium text-sm flex items-center gap-2"
              >
                <i className="fas fa-trash-alt"></i>
                <span>Delete my account</span>
              </button>
            </div>
          </div>

          {/* What will be deleted */}
          <div className="mt-6 pt-6 border-t border-red-200">
            <h4 className="text-sm font-semibold text-red-900 mb-3">
              What will be permanently deleted:
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                'Your profile and personal information',
                'All posts, photos, and videos',
                'Comments and likes',
                'Fans and connections',
                'Performance stats and achievements',
                'Notifications and messages',
                'Saved posts and bookmarks',
                'All sport-specific data (rounds, games, etc.)',
              ].map((item, index) => (
                <div key={index} className="flex items-center gap-2 text-sm text-red-800">
                  <i className="fas fa-times-circle text-red-600 text-xs"></i>
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Delete Account Modal */}
      <DeleteAccountModal
        isOpen={isDeleteModalOpen}
        onClose={() => setIsDeleteModalOpen(false)}
      />
    </div>
  );
}
