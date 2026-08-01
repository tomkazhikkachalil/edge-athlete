'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';
import { AvatarImage } from '@/components/OptimizedImage';
import NotificationBell from '@/components/NotificationBell';
import MessagesBell from '@/components/messages/MessagesBell';
import AdvancedSearchBar from '@/components/AdvancedSearchBar';
import { FEATURE_FLAGS } from '@/lib/features';

interface AppHeaderProps {
  showSearch?: boolean;
  onCreatePost?: () => void;
  onEditProfile?: () => void;
}

export default function AppHeader({ showSearch = true, onCreatePost, onEditProfile }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, initialAuthCheckComplete, profile, signOut, managedProfiles, activeProfile, setActiveProfile } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    // Note: signOut() handles the redirect, no need to router.push
  };

  const handleCreatePost = () => {
    if (onCreatePost) {
      onCreatePost();
    } else {
      router.push('/athlete');
    }
    setIsMobileMenuOpen(false);
  };

  const isActivePath = (path: string) => {
    if (path === '/feed') return pathname === '/feed';
    if (path === '/athlete') return pathname === '/athlete' || pathname?.startsWith('/athlete/');
    if (path === '/messages') return pathname === '/messages' || pathname?.startsWith('/messages/');
    if (path === '/notifications') return pathname === '/notifications';
    return pathname === path;
  };

  const navLinks = [
    { path: '/feed', label: 'Feed', icon: 'fa-home' },
    { path: '/explore', label: 'Explore', icon: 'fa-compass' },
    ...(FEATURE_FLAGS.FEATURE_CALENDAR
      ? [{ path: '/calendar', label: 'Calendar', icon: 'fa-calendar-alt' }]
      : []),
    { path: '/live', label: 'Live', icon: 'fa-circle', accent: 'live' as const },
    { path: '/athlete', label: 'Profile', icon: 'fa-user' },
    { path: '/messages', label: 'Messages', icon: 'fa-comment-alt' },
    { path: '/app/followers', label: 'Connections', icon: 'fa-user-friends', hideOnMobile: true },
  ];

  // While auth state resolves: a logo-only shell with the same height, so
  // public pages (/explore, /u/[username]) don't flash the wrong chrome.
  if (!initialAuthCheckComplete) {
    return (
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40 safe-top safe-x">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center h-16">
            <Image
              src="/logo.png"
              alt="Edge Athlete"
              width={140}
              height={35}
              preload
              className="h-7 w-auto"
            />
          </div>
        </div>
      </header>
    );
  }

  // Logged-out visitors (public pages) get sign-in chrome instead of the
  // authenticated nav: no bells (they'd poll protected APIs), no Post
  // button, no empty avatar or Sign Out — just the way in.
  if (!user) {
    return (
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40 safe-top safe-x">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16 gap-4">
            <Link
              href="/"
              className="flex items-center hover:opacity-80 transition-opacity whitespace-nowrap"
              aria-label="Edge Athlete — go to sign in"
            >
              <Image
                src="/logo.png"
                alt="Edge Athlete"
                width={140}
                height={35}
                preload
                className="h-7 w-auto"
              />
            </Link>
            <div className="flex items-center gap-2 sm:gap-3">
              <Link href="/" className="text-sm font-medium text-gray-700 hover:text-gray-900 px-2 py-2">
                Log in
              </Link>
              <Link
                href="/"
                className="bg-violet-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
              >
                Sign up
              </Link>
            </div>
          </div>
        </div>
        {showSearch && (
          <div className="border-t border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
              <AdvancedSearchBar />
            </div>
          </div>
        )}
      </header>
    );
  }

  return (
    <>
      {/* Desktop & Tablet Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40 safe-top safe-x">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left - Logo & Navigation */}
            <div className="flex items-center gap-6 flex-1">
              <button
                onClick={() => router.push('/feed')}
                className="flex items-center hover:opacity-80 transition-opacity whitespace-nowrap"
                aria-label="Edge Athlete — go to feed"
              >
                <Image
                  src="/logo.png"
                  alt="Edge Athlete"
                  width={140}
                  height={35}
                  preload
                  className="h-7 w-auto"
                />
              </button>

              {/* Desktop Navigation.
                  Breakpoint is `lg` (1024px), NOT `md`: the full header — logo +
                  7 nav links + 3 icon buttons + Post + the account menu — needs
                  ~834px. At md (768px, iPad portrait) it overflowed the viewport
                  by 66px and pushed the account menu off-screen entirely, which
                  also made Sign Out unreachable. 768–1023px uses the drawer,
                  which carries every one of these destinations. */}
              <nav className="hidden lg:flex items-center gap-4 lg:gap-6">
                {navLinks.map((link) => (
                  <button
                    key={link.path}
                    onClick={() => {
                      router.push(link.path);
                      setIsProfileDropdownOpen(false);
                    }}
                    className={`text-sm font-medium transition-colors pb-0.5 ${
                      isActivePath(link.path)
                        ? link.accent === 'live'
                          ? 'text-red-600 border-b-2 border-red-600'
                          : 'text-violet-600 border-b-2 border-violet-600'
                        : 'text-gray-700 hover:text-gray-900'
                    }`}
                  >
                    {link.accent === 'live' && (
                      <span className="inline-block w-1.5 h-1.5 bg-red-600 rounded-full mr-1.5 animate-pulse align-middle"></span>
                    )}
                    {link.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Right - Actions */}
            <div className="flex items-center gap-2 sm:gap-3">
              <MessagesBell />
              <NotificationBell />

              <button
                onClick={() => router.push('/app/followers')}
                className="hidden sm:block text-gray-600 hover:text-gray-900 p-2"
                title="Fans & Connections"
                aria-label="View connections"
              >
                <i className="fas fa-user-friends text-lg"></i>
              </button>

              <button
                onClick={handleCreatePost}
                className="bg-violet-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-violet-700 transition-colors flex items-center gap-2 text-sm font-medium"
                aria-label="Create new post"
              >
                <i className="fas fa-plus"></i>
                <span className="hidden sm:inline">Post</span>
              </button>

              {/* Desktop Profile Dropdown — `lg` to match the nav above. */}
              <div className="hidden lg:block relative">
                <button
                  onClick={() => setIsProfileDropdownOpen(!isProfileDropdownOpen)}
                  className="flex items-center gap-2 hover:bg-gray-100 rounded-lg p-1.5 transition-colors"
                  aria-label="Account menu"
                  aria-expanded={isProfileDropdownOpen}
                >
                  <AvatarImage
                    src={profile?.avatar_url}
                    alt="Profile"
                    size={32}
                    fallbackInitials={getInitials(
                      formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)
                    )}
                  />
                  <i className={`fas fa-chevron-down text-xs text-gray-500 transition-transform ${isProfileDropdownOpen ? 'rotate-180' : ''}`}></i>
                </button>

                {/* Dropdown Menu */}
                {isProfileDropdownOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setIsProfileDropdownOpen(false)}
                    />
                    <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-lg border border-gray-200 py-2 z-20">
                      <div className="px-4 py-3 border-b border-gray-100">
                        <p className="text-sm font-semibold text-gray-900">
                          {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)}
                        </p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {getHandle(profile || {})}
                        </p>
                      </div>

                      {/* Guardian-profiles: in-session switching to managed
                          athletes. Authorization is the profile_access row,
                          re-checked server-side on every write. */}
                      {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && (
                        <div className="py-1 border-b border-gray-100">
                          <p className="px-4 pt-1 pb-0.5 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                            Your athletes
                          </p>
                          {managedProfiles.map(mp => (
                            <button
                              key={mp.id}
                              onClick={() => {
                                setActiveProfile(activeProfile?.id === mp.id ? null : mp);
                                setIsProfileDropdownOpen(false);
                              }}
                              className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                            >
                              <i className={`fas ${activeProfile?.id === mp.id ? 'fa-circle-check text-violet-600' : 'fa-child-reaching'} w-4`}></i>
                              <span>
                                {formatDisplayName(mp.first_name, null, mp.last_name, mp.full_name)}
                                {activeProfile?.id === mp.id && (
                                  <span className="ml-1 text-xs text-violet-600">(active)</span>
                                )}
                              </span>
                            </button>
                          ))}
                          {managedProfiles.length > 0 && (
                            <>
                              <button
                                onClick={() => {
                                  router.push('/app/guardian/approvals');
                                  setIsProfileDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-violet-700 hover:bg-violet-50 flex items-center gap-3"
                              >
                                <i className="fas fa-list-check w-4"></i>
                                <span>Approval queue</span>
                              </button>
                              <button
                                onClick={() => {
                                  router.push('/app/guardian/transfers');
                                  setIsProfileDropdownOpen(false);
                                }}
                                className="w-full text-left px-4 py-2 text-sm text-violet-700 hover:bg-violet-50 flex items-center gap-3"
                              >
                                <i className="fas fa-right-left w-4"></i>
                                <span>Account transfers</span>
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              router.push('/app/guardian/add-athlete');
                              setIsProfileDropdownOpen(false);
                            }}
                            className="w-full text-left px-4 py-2 text-sm text-violet-700 hover:bg-violet-50 flex items-center gap-3"
                          >
                            <i className="fas fa-plus w-4"></i>
                            <span>Add an athlete</span>
                          </button>
                        </div>
                      )}

                      <div className="py-1">
                        <button
                          onClick={() => {
                            router.push('/athlete');
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        >
                          <i className="fas fa-user w-4"></i>
                          <span>View Profile</span>
                        </button>
                        <button
                          onClick={() => {
                            if (onEditProfile) {
                              onEditProfile();
                            } else {
                              router.push('/athlete');
                            }
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        >
                          <i className="fas fa-edit w-4"></i>
                          <span>Edit Profile</span>
                        </button>
                        <button
                          onClick={() => {
                            router.push('/athlete/saved');
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        >
                          <i className="fas fa-bookmark w-4"></i>
                          <span>Saved Posts</span>
                        </button>
                        <button
                          onClick={() => {
                            router.push('/settings');
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center gap-3"
                        >
                          <i className="fas fa-cog w-4"></i>
                          <span>Settings</span>
                        </button>
                      </div>

                      <div className="border-t border-gray-100 py-1">
                        <button
                          onClick={() => {
                            handleSignOut();
                            setIsProfileDropdownOpen(false);
                          }}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-3"
                        >
                          <i className="fas fa-sign-out-alt w-4"></i>
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Mobile Menu Button */}
              <button
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="lg:hidden text-gray-700 hover:text-gray-900 p-2"
                aria-label="Toggle mobile menu"
                aria-expanded={isMobileMenuOpen}
              >
                <i className={`fas ${isMobileMenuOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
              </button>
            </div>
          </div>
        </div>

        {/* Search Bar - Below header on certain pages */}
        {showSearch && (
          <div className="border-t border-gray-100">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3">
              <AdvancedSearchBar />
            </div>
          </div>
        )}
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-72 max-w-[85vw] bg-white shadow-lg z-50 transform transition-transform duration-300 ease-in-out lg:hidden safe-top safe-bottom ${
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">
                <span className="sr-only">Menu</span>
                <Image src="/logo.png" alt="" width={120} height={30} className="h-6 w-auto" />
              </h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-gray-500 hover:text-gray-700 p-2 -m-2 rounded-lg"
                aria-label="Close menu"
              >
                <i className="fas fa-times text-xl"></i>
              </button>
            </div>
          </div>

          {/* Profile Section */}
          <div className="p-4 border-b border-gray-200">
            <button
              onClick={() => {
                router.push('/athlete');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full hover:bg-gray-50 rounded-lg p-2 transition-colors"
            >
              <AvatarImage
                src={profile?.avatar_url}
                alt="Profile"
                size={48}
                fallbackInitials={getInitials(
                  formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)
                )}
              />
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">
                  {formatDisplayName(profile?.first_name, null, profile?.last_name, profile?.full_name)}
                </p>
                <p className="text-sm text-gray-500">View Profile</p>
              </div>
            </button>
          </div>

          {/* Navigation Links.
              `min-h-0 overflow-y-auto` is load-bearing, not decoration: this list
              (7 nav links + Create Post + Edit Profile + Saved Posts + Settings +
              Sign Out) is ~840px tall. On a 667px-tall viewport — iPhone SE, the
              shortest phone we support — Saved Posts, Settings and **Sign Out**
              fell below the fold with nothing to scroll, so a signed-in user on
              that device could not sign out. `min-h-0` is required for a flex
              child to shrink below its content height and actually scroll. */}
          <nav className="flex-1 min-h-0 overflow-y-auto p-4 space-y-2">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => {
                  router.push(link.path);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left rounded-lg transition-colors ${
                  isActivePath(link.path)
                    ? link.accent === 'live'
                      ? 'bg-red-50 text-red-600'
                      : 'bg-violet-50 text-violet-600'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-violet-600'
                }`}
              >
                <i className={`fas ${link.icon} w-5 text-center ${link.accent === 'live' ? 'text-red-600 animate-pulse text-[10px]' : ''}`}></i>
                <span className="font-medium">{link.label}</span>
              </button>
            ))}

            {/* Guardian-profiles, mirroring the desktop dropdown above. This
                block previously existed ONLY in that dropdown, so profile
                switching, the approval queue and Add an athlete were desktop-
                only — and after the nav moved to `lg`, tablets lost them too.
                The drawer has to be a superset of the dropdown, or raising the
                breakpoint silently removes features. */}
            {FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && (
              <div className="pt-2 mt-2 border-t border-gray-200">
                <p className="px-4 pb-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wide">
                  Your athletes
                </p>
                {managedProfiles.map(mp => (
                  <button
                    key={mp.id}
                    onClick={() => {
                      setActiveProfile(activeProfile?.id === mp.id ? null : mp);
                      setIsMobileMenuOpen(false);
                    }}
                    className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
                  >
                    <i className={`fas ${activeProfile?.id === mp.id ? 'fa-circle-check text-violet-600' : 'fa-child-reaching'} w-5 text-center`}></i>
                    <span className="font-medium">
                      {formatDisplayName(mp.first_name, null, mp.last_name, mp.full_name)}
                      {activeProfile?.id === mp.id && (
                        <span className="ml-1 text-xs text-violet-600">(active)</span>
                      )}
                    </span>
                  </button>
                ))}
                {managedProfiles.length > 0 && (
                  <>
                    <button
                      onClick={() => {
                        router.push('/app/guardian/approvals');
                        setIsMobileMenuOpen(false);
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-violet-700 hover:bg-violet-50 rounded-lg transition-colors"
                    >
                      <i className="fas fa-list-check w-5 text-center"></i>
                      <span className="font-medium">Approval queue</span>
                    </button>
                    <button
                      onClick={() => {
                        router.push('/app/guardian/transfers');
                        setIsMobileMenuOpen(false);
                      }}
                      className="flex items-center gap-3 w-full px-4 py-3 text-left text-violet-700 hover:bg-violet-50 rounded-lg transition-colors"
                    >
                      <i className="fas fa-right-left w-5 text-center"></i>
                      <span className="font-medium">Account transfers</span>
                    </button>
                  </>
                )}
                <button
                  onClick={() => {
                    router.push('/app/guardian/add-athlete');
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex items-center gap-3 w-full px-4 py-3 text-left text-violet-700 hover:bg-violet-50 rounded-lg transition-colors"
                >
                  <i className="fas fa-plus w-5 text-center"></i>
                  <span className="font-medium">Add an athlete</span>
                </button>
              </div>
            )}

            <button
              onClick={handleCreatePost}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-violet-50 hover:text-violet-600 rounded-lg transition-colors"
            >
              <i className="fas fa-plus w-5 text-center"></i>
              <span className="font-medium">Create Post</span>
            </button>

            <button
              onClick={() => {
                if (onEditProfile) {
                  onEditProfile();
                } else {
                  router.push('/athlete');
                }
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-violet-50 hover:text-violet-600 rounded-lg transition-colors"
            >
              <i className="fas fa-edit w-5 text-center"></i>
              <span className="font-medium">Edit Profile</span>
            </button>

            <button
              onClick={() => {
                router.push('/athlete/saved');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-violet-50 hover:text-violet-600 rounded-lg transition-colors"
            >
              <i className="fas fa-bookmark w-5 text-center"></i>
              <span className="font-medium">Saved Posts</span>
            </button>

            <button
              onClick={() => {
                router.push('/settings');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-violet-50 hover:text-violet-600 rounded-lg transition-colors"
            >
              <i className="fas fa-cog w-5 text-center"></i>
              <span className="font-medium">Settings</span>
            </button>

            <div className="border-t border-gray-200 my-2"></div>

            <button
              onClick={() => {
                handleSignOut();
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-red-600 hover:bg-red-50 rounded-lg transition-colors"
            >
              <i className="fas fa-sign-out-alt w-5 text-center"></i>
              <span className="font-medium">Sign Out</span>
            </button>
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-gray-200">
            <div className="flex items-center justify-center gap-3 text-xs mb-2">
              <Link href="/terms" className="text-gray-500 hover:text-gray-700">Terms</Link>
              <span className="text-gray-300">·</span>
              <Link href="/privacy" className="text-gray-500 hover:text-gray-700">Privacy</Link>
              <span className="text-gray-300">·</span>
              <Link href="/contact" className="text-gray-500 hover:text-gray-700">Contact</Link>
            </div>
            <p className="text-xs text-gray-500 text-center">
              Edge Athlete &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
