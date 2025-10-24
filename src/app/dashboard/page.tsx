'use client';

import { useAuth } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function Dashboard() {
  const { user, profile, loading, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push('/');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-blue-50">
        <div className="text-center">
          <i className="fas fa-spinner fa-spin text-4xl text-blue-600 mb-4"></i>
          <p className="text-gray-600">Loading your profile...</p>
        </div>
      </div>
    );
  }

  if (!user || !profile) {
    return null;
  }

  const handleSignOut = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <div className="min-h-screen bg-blue-50">
      {/* Header */}
      <div className="w-full bg-blue-600 py-4 px-4 sm:px-6">
        <div className="flex justify-between items-center max-w-6xl mx-auto">
          <h1 className="text-2xl sm:text-3xl font-bold text-white">Edge Athlete</h1>
          <button
            onClick={handleSignOut}
            className="bg-blue-700 hover:bg-blue-800 text-white px-4 py-2 rounded-md transition duration-300 text-sm font-medium"
          >
            <i className="fas fa-sign-out-alt mr-2"></i>
            Sign Out
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-4xl mx-auto p-6">
        {/* Welcome Section */}
        <div className="bg-white rounded-lg shadow-lg p-6 mb-6">
          <h2 className="text-2xl font-bold text-blue-800 mb-2">
            Welcome, {profile.first_name || profile.nickname || 'Athlete'}!
          </h2>
          <p className="text-gray-600">
            Here&apos;s your athlete profile information
          </p>
        </div>

        {/* Profile Information */}
        <div className="bg-white rounded-lg shadow-lg p-6">
          <h3 className="text-xl font-bold text-gray-800 mb-6 flex items-center">
            <i className="fas fa-user-circle text-blue-600 mr-3"></i>
            Profile Information
          </h3>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Personal Info */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-700 text-lg border-b pb-2">Personal Information</h4>
              
              <div className="space-y-3">
                <div>
                  <label className="text-sm font-medium text-gray-500">Full Name</label>
                  <p className="text-gray-800 font-medium">
                    {profile.first_name || profile.last_name 
                      ? `${profile.first_name || ''} ${profile.last_name || ''}`.trim()
                      : 'Not provided'}
                  </p>
                </div>

                {profile.nickname && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Nickname</label>
                    <p className="text-gray-800 font-medium">{profile.nickname}</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-500">Email</label>
                  <p className="text-gray-800 font-medium">{profile.email}</p>
                </div>

                {profile.phone && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Phone</label>
                    <p className="text-gray-800 font-medium">{profile.phone}</p>
                  </div>
                )}

                {profile.birthday && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Birthday</label>
                    <p className="text-gray-800 font-medium">
                      {new Date(profile.birthday).toLocaleDateString()}
                    </p>
                  </div>
                )}

                {profile.gender && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Gender</label>
                    <p className="text-gray-800 font-medium capitalize">{profile.gender}</p>
                  </div>
                )}
              </div>
            </div>

            {/* Location & Other Info */}
            <div className="space-y-4">
              <h4 className="font-semibold text-gray-700 text-lg border-b pb-2">Location & Details</h4>
              
              <div className="space-y-3">
                {profile.location && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Location</label>
                    <p className="text-gray-800 font-medium">{profile.location}</p>
                  </div>
                )}

                {profile.postal_code && (
                  <div>
                    <label className="text-sm font-medium text-gray-500">Postal Code</label>
                    <p className="text-gray-800 font-medium">{profile.postal_code}</p>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium text-gray-500">User Type</label>
                  <p className="text-gray-800 font-medium capitalize">
                    <i className="fas fa-person-running text-blue-600 mr-2"></i>
                    {profile.user_type}
                  </p>
                </div>

                <div>
                  <label className="text-sm font-medium text-gray-500">Member Since</label>
                  <p className="text-gray-800 font-medium">
                    {new Date(profile.created_at).toLocaleDateString()}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="mt-8 pt-6 border-t border-gray-200">
            <div className="flex flex-wrap gap-4">
              <button className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-2 rounded-md transition duration-300 font-medium">
                <i className="fas fa-edit mr-2"></i>
                Edit Profile
              </button>
              <button className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-md transition duration-300 font-medium">
                <i className="fas fa-trophy mr-2"></i>
                View Achievements
              </button>
              <button className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-md transition duration-300 font-medium">
                <i className="fas fa-users mr-2"></i>
                Find Clubs
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}