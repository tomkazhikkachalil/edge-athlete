'use client';

import { useState } from 'react';
import SectionInfo from '@/components/SectionInfo';
import { readUnitPreference, writeUnitPreference, type DistanceUnit } from '@/lib/activities/format';
import { useAuth } from '@/lib/auth';
import DeleteAccountModal from './DeleteAccountModal';
import { useEditProfile } from '@/components/EditProfileHost';
import { formatDisplayName, formatHeight, parseDateLocal } from '@/lib/formatters';
import { COPY } from '@/lib/copy';
import InstallSettingsCard from '@/components/install/InstallSettingsCard';

export default function AccountSettings() {
  const { profile } = useAuth();
  // The shared editor (EditProfileHost) — opened over Settings, in place.
  const editProfile = useEditProfile();
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  // Units (Oct 29 2026): the one device-level choice (units.ts) — °C · km or
  // °F · mi — finally has a row here beside the body metrics it governs.
  const [unit, setUnit] = useState<DistanceUnit>(() => readUnitPreference());
  const chooseUnit = (u: DistanceUnit) => {
    writeUnitPreference(u);
    setUnit(u);
  };

  return (
    <div className="space-y-8">
      {/* Profile Information Section */}
      <div>
        <SectionInfo as="h3" heading="Profile Information" headingClassName="text-2xl font-bold text-primary tracking-tight" className="mb-6">
          <p>View your account details and personal information</p>
        </SectionInfo>
        <div className="bg-surface rounded-xl p-6 sm:p-8 border border-border shadow-sm">
          {/* Basic Info */}
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-violet-100 dark:bg-violet-950/60 rounded-lg flex items-center justify-center">
                <i className="fas fa-user text-brand-fg text-lg"></i>
              </div>
              <h4 className="text-lg font-bold text-primary tracking-tight">Basic Information</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Full Name
                </label>
                <p className="text-base font-medium text-primary">
                  {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name) || (
                    <span className="text-faint italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Handle
                </label>
                <p className="text-base font-medium text-primary">
                  {profile?.handle ? `@${profile.handle}` : profile?.full_name ? `@${profile.full_name}` : (
                    <span className="text-faint italic">Not set</span>
                  )}
                </p>
                {!profile?.handle && profile?.full_name && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                    <i className="fas fa-exclamation-triangle"></i>
                    Using legacy username. Update to new handle format.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <p className="text-base font-medium text-primary">{profile?.email || (
                  <span className="text-faint italic">Not set</span>
                )}</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Account Type
                </label>
                <p className="text-base font-medium text-primary capitalize">{profile?.user_type || 'Athlete'}</p>
              </div>
            </div>
          </div>

          {/* Training */}
          <div className="pt-8 border-t border-border">
            <div className="flex items-center gap-3 mb-5">
              <div className="w-10 h-10 bg-purple-100 dark:bg-purple-950/60 rounded-lg flex items-center justify-center">
                <i className="fas fa-chart-line text-purple-600 dark:text-purple-400 text-lg"></i>
              </div>
              <h4 className="text-lg font-bold text-primary tracking-tight">Body Metrics & Details</h4>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Height
                </label>
                <p className="text-base font-medium text-primary">
                  {profile?.height_cm ? formatHeight(profile.height_cm) : (
                    <span className="text-faint italic">Not set</span>
                  )}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Weight
                </label>
                <p className="text-base font-medium text-primary">
                  {profile?.weight_display
                    ? `${profile.weight_display} ${profile.weight_unit || 'lbs'}`
                    : <span className="text-faint italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Date of Birth
                </label>
                <p className="text-base font-medium text-primary">
                  {(profile?.dob || profile?.birthday)
                    ? parseDateLocal((profile.dob || profile.birthday) as string).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                      })
                    : <span className="text-faint italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Location
                </label>
                <p className="text-base font-medium text-primary">
                  {profile?.location || <span className="text-faint italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Class Year
                </label>
                <p className="text-base font-medium text-primary">
                  {profile?.class_year || <span className="text-faint italic">Not set</span>}
                </p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                  Profile Visibility
                </label>
                <div className="mt-1">
                  <span className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-semibold ${
                    profile?.visibility === 'public'
                      ? 'bg-green-50 dark:bg-green-950/40 text-green-700 dark:text-green-300 border border-green-200 dark:border-green-800'
                      : 'bg-orange-50 dark:bg-orange-950/40 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800'
                  }`}>
                    <i className={`fas fa-${profile?.visibility === 'public' ? 'globe' : 'lock'}`}></i>
                    {profile?.visibility === 'public' ? 'Public' : 'Private'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-border" data-units-row="">
            <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-2">
              Units
            </label>
            <div className="inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Units">
              {([['km', 'Metric', 'Metric — °C, km, kg'], ['mi', 'Imperial', 'Imperial — °F, mi, lb']] as const).map(([u, label, name]) => (
                <button
                  key={u}
                  type="button"
                  onClick={() => chooseUnit(u)}
                  aria-pressed={unit === u}
                  aria-label={name}
                  data-units-choice={u}
                  className={`rounded-full px-4 py-1 text-sm font-semibold min-h-[44px] whitespace-nowrap ${unit === u ? 'bg-brand text-white' : 'text-secondary'}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="mt-2 text-xs text-muted">
              {unit === 'mi' ? '°F, miles and pounds' : '°C, kilometres and kilograms'} — temperatures, distances and weights everywhere in the app. Saved on this device.
            </p>
          </div>

          <div className="mt-8 pt-6 border-t border-border">
            <button
              onClick={() => editProfile.open()}
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-white font-semibold rounded-lg hover:bg-brand-hover transition-colors shadow-sm"
            >
              <i className="fas fa-edit"></i>
              Edit Profile Details
            </button>
          </div>
        </div>
      </div>

      {/* Download the app — the door that is always here. */}
      <InstallSettingsCard />

      {/* Danger Zone Section */}
      <div className="border-t border-border pt-8">
        <div className="bg-red-50 dark:bg-red-950/40 border-2 border-red-200 dark:border-red-800 rounded-lg p-6">
          <div className="flex items-start gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-red-100 dark:bg-red-950/60 rounded-full flex items-center justify-center">
                <i className="fas fa-exclamation-triangle text-red-600 dark:text-red-400 text-xl"></i>
              </div>
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-2">Danger Zone</h3>
              <p className="text-red-800 dark:text-red-200 text-sm mb-4">
                {COPY.ACCOUNT.DANGER_ZONE}
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
          <div className="mt-6 pt-6 border-t border-red-200 dark:border-red-800">
            <h4 className="text-sm font-semibold text-red-900 dark:text-red-200 mb-3">
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
                <div key={index} className="flex items-center gap-2 text-sm text-red-800 dark:text-red-200">
                  <i className="fas fa-times-circle text-red-600 dark:text-red-400 text-xs"></i>
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
