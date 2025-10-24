'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { getSportDefinition, getSportAdapter, type SportKey } from '@/lib/sports';

export default function SportActivityDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const sportKey = params.sport_key as string;
  const activityId = params.id as string;

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
      return;
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    const checkRoute = async () => {
      try {
        // Check if this is a valid sport
        const sportDef = getSportDefinition(sportKey as SportKey);
        const adapter = getSportAdapter(sportKey as SportKey);
        
        if (!sportDef) {
          setNotFound(true);
          setLoading(false);
          return;
        }

        // For golf, redirect to the specific golf route
        if (sportKey === 'golf' && adapter.isEnabled()) {
          router.replace(`/app/sport/golf/rounds/${activityId}`);
          return;
        }

        // For other sports, show coming soon
        setLoading(false);
        
      } catch {
        setNotFound(true);
        setLoading(false);
      }
    };

    if (user?.id && sportKey && activityId) {
      checkRoute();
    }
  }, [user?.id, sportKey, activityId, router]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">Loading activity...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">Activity Not Found</h1>
          <p className="text-gray-600 mb-8">This activity does not exist or the sport is not supported yet.</p>
          <button
            onClick={() => router.back()}
            className="inline-flex items-center px-4 py-2 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 transition-colors"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // This is a future sport activity detail page
  const sportDef = getSportDefinition(sportKey as SportKey);
  const adapter = getSportAdapter(sportKey as SportKey);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navigation */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-4xl mx-auto px-4 py-4">
          <button
            onClick={() => router.back()}
            className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <i className="fas fa-arrow-left mr-2"></i>
            Back to Activity
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-section">
        <div className="bg-white rounded-lg shadow-sm p-base">
          <div className="text-center py-12">
            <i className={`${sportDef.icon_id} text-6xl text-gray-300 mb-6`}></i>
            <h1 className="text-3xl font-bold text-gray-900 mb-4">
              {sportDef.display_name} Activity Details
            </h1>
            <p className="text-gray-600 mb-6">
              Detailed {sportDef.display_name.toLowerCase()} activity tracking is coming soon! 
              This will show comprehensive stats and performance data.
            </p>
            
            <div className="bg-blue-50 border border-blue-200 rounded-md p-4 mb-6">
              <div className="text-sm text-blue-800 space-y-1">
                <p><strong>Route:</strong> <code>/app/sport/{sportKey}/activity/{activityId}</code></p>
                <p><strong>Sport:</strong> {sportDef.display_name}</p>
                <p><strong>Activity ID:</strong> {activityId}</p>
                <p><strong>Status:</strong> {adapter.isEnabled() ? 'Enabled' : 'Coming Soon'}</p>
              </div>
            </div>

            <div className="space-y-2 text-sm text-gray-500 mb-6">
              <p>📊 Detailed performance metrics</p>
              <p>📈 Progress tracking</p>
              <p>🎯 Goal setting and achievements</p>
              <p>📝 Notes and observations</p>
            </div>

            <div className="px-4 py-2 bg-amber-50 border border-amber-200 rounded-md">
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