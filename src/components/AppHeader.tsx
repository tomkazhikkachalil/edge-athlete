'use client';

import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { AvatarImage } from '@/components/OptimizedImage';
import NotificationBell from '@/components/NotificationBell';
import AdvancedSearchBar from '@/components/AdvancedSearchBar';

interface AppHeaderProps {
  showSearch?: boolean;
  onCreatePost?: () => void;
}

export default function AppHeader({ showSearch = true, onCreatePost }: AppHeaderProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { profile, signOut } = useAuth();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isProfileDropdownOpen, setIsProfileDropdownOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
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
    if (path === '/notifications') return pathname === '/notifications';
    return pathname === path;
  };

  const navLinks = [
    { path: '/feed', label: 'Feed', icon: 'fa-home' },
    { path: '/athlete', label: 'Profile', icon: 'fa-user' },
    { path: '/app/followers', label: 'Connections', icon: 'fa-user-friends', hideOnMobile: true },
  ];

  return (
    <>
      {/* Desktop & Tablet Header */}
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="flex items-center justify-between h-16">
            {/* Left - Logo & Navigation */}
            <div className="flex items-center gap-6 flex-1">
              <button
                onClick={() => router.push('/feed')}
                className="text-xl font-bold text-gray-900 hover:text-blue-600 transition-colors whitespace-nowrap"
              >
                Edge Athlete
              </button>

              {/* Desktop Navigation */}
              <nav className="hidden md:flex items-center gap-4 lg:gap-6">
                {navLinks.map((link) => (
                  <button
                    key={link.path}
                    onClick={() => {
                      router.push(link.path);
                      setIsProfileDropdownOpen(false);
                    }}
                    className={`text-sm font-medium transition-colors pb-0.5 ${
                      isActivePath(link.path)
                        ? 'text-blue-600 border-b-2 border-blue-600'
                        : 'text-gray-700 hover:text-gray-900'
                    }`}
                  >
                    {link.label}
                  </button>
                ))}
              </nav>
            </div>

            {/* Right - Actions */}
            <div className="flex items-center gap-2 sm:gap-3">
              <NotificationBell />

              <button
                onClick={() => router.push('/app/followers')}
                className="hidden sm:block text-gray-600 hover:text-gray-900 p-2"
                title="Followers & Connections"
                aria-label="View connections"
              >
                <i className="fas fa-user-friends text-lg"></i>
              </button>

              <button
                onClick={handleCreatePost}
                className="bg-blue-600 text-white px-3 sm:px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors flex items-center gap-2 text-sm font-medium"
                aria-label="Create new post"
              >
                <i className="fas fa-plus"></i>
                <span className="hidden sm:inline">Post</span>
              </button>

              {/* Desktop Profile Dropdown */}
              <div className="hidden md:block relative">
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
                          {profile?.full_name ? `@${profile.full_name}` : ''}
                        </p>
                      </div>

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
                            router.push('/athlete');
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
                className="md:hidden text-gray-700 hover:text-gray-900 p-2"
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
              <div className="max-w-2xl">
                <AdvancedSearchBar />
              </div>
            </div>
          </div>
        )}
      </header>

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* Mobile Menu Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-white shadow-lg z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
          isMobileMenuOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Menu</h2>
              <button
                onClick={() => setIsMobileMenuOpen(false)}
                className="text-gray-500 hover:text-gray-700"
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

          {/* Navigation Links */}
          <nav className="flex-1 p-4 space-y-2">
            {navLinks.map((link) => (
              <button
                key={link.path}
                onClick={() => {
                  router.push(link.path);
                  setIsMobileMenuOpen(false);
                }}
                className={`flex items-center gap-3 w-full px-4 py-3 text-left rounded-lg transition-colors ${
                  isActivePath(link.path)
                    ? 'bg-blue-50 text-blue-600'
                    : 'text-gray-700 hover:bg-gray-50 hover:text-blue-600'
                }`}
              >
                <i className={`fas ${link.icon} w-5 text-center`}></i>
                <span className="font-medium">{link.label}</span>
              </button>
            ))}

            <button
              onClick={handleCreatePost}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-plus w-5 text-center"></i>
              <span className="font-medium">Create Post</span>
            </button>

            <button
              onClick={() => {
                router.push('/athlete/saved');
                setIsMobileMenuOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-bookmark w-5 text-center"></i>
              <span className="font-medium">Saved Posts</span>
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
            <p className="text-xs text-gray-500 text-center">
              Edge Athlete &copy; 2025
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
