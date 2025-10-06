'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { AvatarImage } from '@/components/OptimizedImage';

export default function MobileNav() {
  const [isOpen, setIsOpen] = useState(false);
  const router = useRouter();
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
    setIsOpen(false);
  };

  return (
    <>
      {/* Mobile Menu Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="md:hidden text-gray-700 hover:text-gray-900 p-2"
        aria-label="Toggle mobile menu"
      >
        <i className={`fas ${isOpen ? 'fa-times' : 'fa-bars'} text-xl`}></i>
      </button>

      {/* Mobile Menu Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black bg-opacity-50 z-40 md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Mobile Menu Drawer */}
      <div
        className={`fixed top-0 right-0 h-full w-64 bg-white shadow-lg z-50 transform transition-transform duration-300 ease-in-out md:hidden ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900">Menu</h2>
              <button
                onClick={() => setIsOpen(false)}
                className="text-gray-500 hover:text-gray-700"
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
                setIsOpen(false);
              }}
              className="flex items-center gap-3 w-full hover:bg-gray-50 rounded-lg p-2 transition-colors"
            >
              <AvatarImage
                src={profile?.avatar_url}
                alt="Profile"
                size={48}
                fallbackInitials={getInitials(
                  formatDisplayName(
                    profile?.first_name,
                    profile?.middle_name,
                    profile?.last_name,
                    profile?.full_name
                  )
                )}
              />
              <div className="flex-1 text-left">
                <p className="font-semibold text-gray-900">
                  {formatDisplayName(
                    profile?.first_name,
                    profile?.middle_name,
                    profile?.last_name,
                    profile?.full_name
                  )}
                </p>
                <p className="text-sm text-gray-500">View Profile</p>
              </div>
            </button>
          </div>

          {/* Navigation Links */}
          <nav className="flex-1 p-4 space-y-2">
            <button
              onClick={() => {
                router.push('/feed');
                setIsOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-home w-5 text-center"></i>
              <span className="font-medium">Feed</span>
            </button>

            <button
              onClick={() => {
                router.push('/athlete');
                setIsOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-user w-5 text-center"></i>
              <span className="font-medium">Profile</span>
            </button>

            <button
              onClick={() => {
                router.push('/app/followers');
                setIsOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-user-friends w-5 text-center"></i>
              <span className="font-medium">Connections</span>
            </button>

            <button
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-compass w-5 text-center"></i>
              <span className="font-medium">Explore</span>
            </button>

            <button
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-users w-5 text-center"></i>
              <span className="font-medium">Following</span>
            </button>

            <div className="border-t border-gray-200 my-2"></div>

            <button
              onClick={() => {
                router.push('/app/profile');
                setIsOpen(false);
              }}
              className="flex items-center gap-3 w-full px-4 py-3 text-left text-gray-700 hover:bg-blue-50 hover:text-blue-600 rounded-lg transition-colors"
            >
              <i className="fas fa-cog w-5 text-center"></i>
              <span className="font-medium">Settings</span>
            </button>

            <button
              onClick={handleSignOut}
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
