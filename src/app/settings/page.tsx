'use client';

import { useState, useEffect, Suspense, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { useAuth } from '@/lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import AccountSettings from '@/components/settings/AccountSettings';
import PrivacySettings from '@/components/settings/PrivacySettings';
import MessagingSettings from '@/components/settings/MessagingSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import SecuritySettings from '@/components/settings/SecuritySettings';
import AppearanceSettings from '@/components/settings/AppearanceSettings';

// 1091-line modal — only loaded on demand
const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });

type SettingsTab = 'account' | 'privacy' | 'appearance' | 'messaging' | 'notifications' | 'security';

const SETTINGS_TABS: SettingsTab[] = ['account', 'privacy', 'appearance', 'messaging', 'notifications', 'security'];

// useSearchParams must live under Suspense (house rule) — this tiny reader
// honours ?tab=<id> so other surfaces can deep-link to a section (the chat
// dock's settings gear points at ?tab=messaging). Unknown values are
// ignored, leaving the default tab.
function TabParamReader({ onTab }: { onTab: (tab: SettingsTab) => void }) {
  const searchParams = useSearchParams();
  const requested = searchParams.get('tab');
  useEffect(() => {
    if (requested && (SETTINGS_TABS as string[]).includes(requested)) {
      onTab(requested as SettingsTab);
    }
  }, [requested, onTab]);
  return null;
}

export default function SettingsPage() {
  const { user, profile, loading } = useAuth();
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const [isEditProfileModalOpen, setIsEditProfileModalOpen] = useState(false);
  const handleTabParam = useCallback((tab: SettingsTab) => setActiveTab(tab), []);

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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
          <p className="mt-2 text-tertiary">Loading...</p>
        </div>
      </div>
    );
  }

  const tabs: { id: SettingsTab; label: string; icon: string; disabled?: boolean }[] = [
    { id: 'account', label: 'Account', icon: 'fa-user-cog' },
    { id: 'privacy', label: 'Privacy', icon: 'fa-shield-alt' },
    { id: 'appearance', label: 'Appearance', icon: 'fa-moon' },
    { id: 'messaging', label: 'Messaging', icon: 'fa-comment-alt' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
    { id: 'security', label: 'Security', icon: 'fa-lock' },
  ];

  return (
    <div className="min-h-screen bg-canvas">
      <Suspense fallback={null}>
        <TabParamReader onTab={handleTabParam} />
      </Suspense>
      <AppHeader showSearch={false} />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-tertiary hover:text-primary mb-4 inline-flex items-center gap-2 transition-colors min-h-[44px] -my-2"
          >
            <i className="fas fa-arrow-left"></i>
            <span>Back</span>
          </button>
          <h1 className="text-3xl font-bold text-primary">Settings</h1>
          <p className="text-tertiary mt-2">Manage your account settings and preferences</p>
        </div>

        {/* Tabs Navigation */}
        <div className="bg-surface rounded-lg shadow-sm border border-border overflow-hidden">
          <div className="border-b border-border">
            {/* scrollbar-hide + shrink-0: five tabs are ~560px of intrinsic
                width — they scroll cleanly instead of showing a scrollbar
                band with no affordance. */}
            <nav className="flex overflow-x-auto scrollbar-hide" aria-label="Settings tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => !tab.disabled && setActiveTab(tab.id)}
                  disabled={tab.disabled}
                  className={`flex shrink-0 items-center gap-2 px-4 sm:px-6 py-4 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-brand text-brand-fg'
                      : tab.disabled
                      ? 'border-transparent text-faint cursor-not-allowed'
                      : 'border-transparent text-tertiary hover:text-primary hover:border-border-strong'
                  }`}
                >
                  <i className={`fas ${tab.icon}`}></i>
                  <span>{tab.label}</span>
                  {tab.disabled && (
                    <span className="text-xs bg-surface-sunken text-muted px-2 py-0.5 rounded-full">
                      Coming Soon
                    </span>
                  )}
                </button>
              ))}
            </nav>
          </div>

          {/* Tab Content */}
          <div className="p-4 sm:p-6">
            {activeTab === 'account' && (
              <AccountSettings onEditProfile={() => setIsEditProfileModalOpen(true)} />
            )}
            {activeTab === 'privacy' && <PrivacySettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
            {activeTab === 'messaging' && <MessagingSettings />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'security' && <SecuritySettings />}
          </div>
        </div>
      </div>

      {/* Edit Profile Modal */}
      <EditProfileTabs
        isOpen={isEditProfileModalOpen}
        onClose={() => setIsEditProfileModalOpen(false)}
        profile={profile}
        onSave={() => {
          // Profile will be refreshed automatically by useAuth
          setIsEditProfileModalOpen(false);
        }}
      />
    </div>
  );
}
