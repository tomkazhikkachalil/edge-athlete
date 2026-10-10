'use client';

import { useState, useEffect, useRef, Suspense, useCallback } from 'react';
import { backOr } from '@/lib/nav-back';
import { useAuth } from '@/lib/auth';
import { useRouter, useSearchParams } from 'next/navigation';
import AppHeader from '@/components/AppHeader';
import AccountSettings from '@/components/settings/AccountSettings';
import PrivacySettings from '@/components/settings/PrivacySettings';
import HiddenResults from '@/components/settings/HiddenResults';
import MessagingSettings from '@/components/settings/MessagingSettings';
import NotificationSettings from '@/components/settings/NotificationSettings';
import SecuritySettings from '@/components/settings/SecuritySettings';
import SupportSettings from '@/components/settings/SupportSettings';
import AppearanceSettings from '@/components/settings/AppearanceSettings';
import WorkoutRoutinesSettings from '@/components/settings/WorkoutRoutinesSettings';
import ConnectedApps from '@/components/settings/ConnectedApps';
import RecruitingSettings from '@/components/settings/RecruitingSettings';
import { FEATURE_FLAGS } from '@/lib/features';


type SettingsTab = 'account' | 'privacy' | 'recruiting' | 'appearance' | 'routines' | 'connections' | 'messaging' | 'notifications' | 'security' | 'support';

// Connected apps (fix round part 3, mig 247) is a flagged SURFACE: with the
// flag off the tab is neither listed nor reachable by ?tab=connections.
const CONNECTED_APPS = FEATURE_FLAGS.FEATURE_CONNECTED_APPS;

const SETTINGS_TABS: SettingsTab[] = (
  ['account', 'privacy', 'recruiting', 'appearance', 'routines', 'connections', 'messaging', 'notifications', 'security', 'support'] as SettingsTab[]
).filter(tab => tab !== 'connections' || CONNECTED_APPS);

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
  const athleteAccount = profile?.user_type !== 'organizer' && profile?.user_type !== 'scout';
  const [activeTab, setActiveTab] = useState<SettingsTab>('account');
  const handleTabParam = useCallback((tab: SettingsTab) => setActiveTab(tab), []);

  // Six tabs are ~670px of intrinsic width against ~358px on a 390px phone,
  // and `scrollbar-hide` removes the only native hint that the rest exists.
  // Two affordances below: fades on whichever edge has more content, and
  // scrolling the active tab into view so a ?tab= deep link never lands
  // off-screen.
  const tabNavRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Partial<Record<SettingsTab, HTMLButtonElement | null>>>({});
  const [tabOverflow, setTabOverflow] = useState({ left: false, right: false });

  const measureTabOverflow = useCallback(() => {
    const nav = tabNavRef.current;
    if (!nav) return;
    // 1px slack: fractional scroll positions otherwise leave a fade pinned on.
    setTabOverflow({
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    const nav = tabNavRef.current;
    if (!nav) return;
    measureTabOverflow();
    nav.addEventListener('scroll', measureTabOverflow, { passive: true });
    window.addEventListener('resize', measureTabOverflow);
    return () => {
      nav.removeEventListener('scroll', measureTabOverflow);
      window.removeEventListener('resize', measureTabOverflow);
    };
  }, [measureTabOverflow, loading]);

  useEffect(() => {
    const nav = tabNavRef.current;
    const button = tabRefs.current[activeTab];
    if (!nav || !button) return;
    // Adjust scrollLeft directly rather than scrollIntoView(), which also
    // scrolls ancestor scrollers and would yank the whole page vertically.
    const left = button.offsetLeft;
    const right = left + button.offsetWidth;
    const PEEK = 16; // leave a sliver of the neighbour visible
    if (left < nav.scrollLeft) nav.scrollLeft = Math.max(0, left - PEEK);
    else if (right > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = right - nav.clientWidth + PEEK;
    measureTabOverflow();
  }, [activeTab, measureTabOverflow]);

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

  const tabs: { id: SettingsTab; label: string; icon: string }[] = [
    { id: 'account', label: 'Account', icon: 'fa-user-cog' },
    { id: 'privacy', label: 'Privacy', icon: 'fa-shield-alt' },
    // Recruiting lives here since Oct 4 2026 (Tom): the profile shows
    // nothing recruiting-related until the scout program. Organizer and
    // scout accounts are not recruited.
    ...(athleteAccount ? [{ id: 'recruiting' as const, label: 'Recruiting', icon: 'fa-graduation-cap' }] : []),
    { id: 'appearance', label: 'Appearance', icon: 'fa-moon' },
    { id: 'routines', label: 'Routines', icon: 'fa-dumbbell' },
    // Beside Routines on purpose: both feed Vitals.
    ...(CONNECTED_APPS ? [{ id: 'connections' as const, label: 'Connected apps', icon: 'fa-link' }] : []),
    { id: 'messaging', label: 'Messaging', icon: 'fa-comment-alt' },
    { id: 'notifications', label: 'Notifications', icon: 'fa-bell' },
    { id: 'security', label: 'Security', icon: 'fa-lock' },
    // Support & Reporting, Spec 1: the minimal front door (Spec 3 = /help).
    { id: 'support', label: 'Support', icon: 'fa-life-ring' },
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
            onClick={() => backOr(router, '/feed')}
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
          <div className="relative border-b border-border">
            {/* scrollbar-hide + shrink-0: six tabs are ~670px of intrinsic
                width — they scroll cleanly instead of showing a scrollbar
                band. `scrollbar-hide` costs the only native overflow cue,
                so the gradients below stand in for it. */}
            <nav ref={tabNavRef} className="flex overflow-x-auto scrollbar-hide lg:flex-wrap lg:overflow-visible lg:px-2" aria-label="Settings tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  ref={(el) => { tabRefs.current[tab.id] = el; }}
                  onClick={() => setActiveTab(tab.id)}
                  className={`flex shrink-0 items-center gap-2 px-4 sm:px-6 lg:px-4 py-4 lg:py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                    activeTab === tab.id
                      ? 'border-brand text-brand-fg'
                      : 'border-transparent text-tertiary hover:text-primary hover:border-border-strong'
                  }`}
                >
                  <i className={`fas ${tab.icon}`}></i>
                  <span>{tab.label}</span>
                </button>
              ))}
            </nav>
            {/* Decorative overflow cues (phones and tablets). From lg: the tabs
                WRAP instead — ten tabs are wider than the 1024px column, and a
                scroller with a 24px fade hid "Messaging" and everything after
                it on a desktop (Oct 9 2026 appearance round). `from-surface`
                is a theme token, so these follow light/dark. */}
            {tabOverflow.left && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-surface to-transparent lg:hidden"
              />
            )}
            {tabOverflow.right && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-surface to-transparent lg:hidden"
              />
            )}
          </div>

          {/* Tab Content */}
          <div className="p-4 sm:p-6">
            {activeTab === 'account' && (
              <AccountSettings />
            )}
            {activeTab === 'privacy' && (
              <>
                <PrivacySettings />
                {/* Results-kept (241): what you hid from your profile, and the way back. */}
                <HiddenResults />
              </>
            )}
            {activeTab === 'recruiting' && athleteAccount && <RecruitingSettings />}
            {activeTab === 'appearance' && <AppearanceSettings />}
            {activeTab === 'routines' && <WorkoutRoutinesSettings />}
            {activeTab === 'connections' && CONNECTED_APPS && <ConnectedApps />}
            {activeTab === 'messaging' && <MessagingSettings />}
            {activeTab === 'notifications' && <NotificationSettings />}
            {activeTab === 'security' && <SecuritySettings />}
            {activeTab === 'support' && <SupportSettings />}
          </div>
        </div>
      </div>

    </div>
  );
}
