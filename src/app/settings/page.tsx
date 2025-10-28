'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import AccountSettings from '@/components/settings/AccountSettings';
import PrivacySettings from '@/components/settings/PrivacySettings';
import EditProfileTabs from '@/components/EditProfileTabs';

type SettingsTab = 'account' | 'privacy' | 'notifications' | 'security';

export default function SettingsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);

  // Redirect if not authenticated
  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [loading, user, router]);

  if (!loading && !user) {
    return null;
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading...</p>
        </div>
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; icon: string; disabled?: boolean }[] = [
    { id: 'account', label: 'Account', icon: 'fa-user-cog' },
    { id: 'privacy', label: 'Privacy', icon: 'fa-shield-alt' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-bell', disabled: true },
    { id: 'security', label: 'Security', icon: 'fa-lock', disabled: true },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-gray-600 hover:text-gray-900 mb-4 flex items-center gap-2 transition-colors"
          >
            <i className="fas fa-arrow-left"></i>
            <span>Back</span>
          </button>
          <h1 className="text-3xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-600 mt-2">Manage your account settings and preferences</p>
        </div>

        {/* Tabs Navigation */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="border-b border-gray-200">
            <nav className="flex overflow-x-auto" aria-label="Settings tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => !tab.disabled && setActiveTab(tab.id)}
                  disabled={tab.disabled}
                  className={`flex items-center gap-2 px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-600'
                      : tab.disabled
                      ? 'border-transparent text-gray-400 cursor-not-allowed'
                      : 'border-transparent text-gray-600 hover:text-gray-900 hover:border-gray-300'
                  }`}
                >
                  <i className={`fas ${tab.icon}`}></i>
                  <span>{tab.label}</span>
                  {tab.disabled && (
                    <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-6">
            {activeTab === 'account' && (
              <AccountSettings onEditProfile={() => setIsEditProfileModalOpen(true)} />
            )}
            {activeTab === 'privacy' && <PrivacySettings />}
            {activeTab === 'notifications' && (
              <div className="text-center py-12">
                <i className="fas fa-bell text-gray-300 text-5xl mb-4"></i>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Notification Settings
                </h3>
                <p className="text-gray-600">
                  Notification preferences will be available soon.
                </p>
              </div>
            )}
            {activeTab === 'security' && (
              <div className="text-center py-12">
                <i className="fas fa-lock text-gray-300 text-5xl mb-4"></i>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">
                  Security Settings
                </h3>
                <p className="text-gray-600">
                  Security settings will be available soon.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditProfileModalOpen}
        onClose={() => setIsEditProfileModalOpen(false)}
        profile={profile}
        badges={[]}
        highlights={[]}
        performances={[]}
        onSave={() => {
          // Profile will be refreshed automatically by useAuth
          setIsEditProfileModalOpen(false);
        }}
      />
    </div>
  );
}
