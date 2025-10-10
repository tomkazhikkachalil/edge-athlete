'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';

export default function PublicProfilePage() {
  const params = useParams();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const username = params.username as string;

  useEffect(() => {
    const loadPublicProfile = async () => {
      try {
        // TODO: Implement public profile API
        // const response = await fetch(`/api/public/profile/${username}`);
        // if (!response.ok) {
        //   setNotFound(true);
        //   return;
        // }
        // const data = await response.json();
        // setProfile(data);

        // For now, show coming soon message
        setTimeout(() => {
          setNotFound(false);
          setLoading(false);
        }, 1000);

      } catch {
        // Failed to load public profile
        setNotFound(true);
        setLoading(false);
      }
    };

    if (username) {
      loadPublicProfile();
    }
  }, [username]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading profile...</p>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Profile Not Found</h1>
          <p className="text-gray-600 mb-8">The profile @{username} does not exist or is private.</p>
          <Link
            href="/"
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <i className="fas fa-home mr-2"></i>
            Go Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-section">
        <div className="bg-white rounded-lg shadow-sm p-base">
          <div className="text-center py-12">
            <i className="fas fa-user-circle text-6xl text-gray-300 mb-6"></i>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">Public Profiles</h1>
            <p className="text-gray-600 mb-6">
              Public athlete profiles are coming soon! Users will be able to share their achievements and stats at:
            </p>
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <code className="text-blue-800 font-mono">
                /u/{username}
              </code>
            </div>
            <div className="space-y-2 text-sm text-gray-500">
              <p>✨ Public profile showcase</p>
              <p>🏆 Achievement highlights</p>
              <p>📊 Performance statistics</p>
              <p>🔗 Social media links</p>
            </div>
            
            <div className="mt-8 px-4 py-2 bg-amber-50 border border-amber-200 rounded-md">
              <div className="flex items-center justify-center">
                <i className="fas fa-clock text-amber-600 mr-2" aria-hidden="true"></i>
                <span className="text-sm text-amber-800 font-medium">Coming Soon</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}