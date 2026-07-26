'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import WorkoutEditorScreen from '@/components/workouts/WorkoutEditorScreen';

/**
 * /app/workout/new — back-log a past workout. Client-local until Save
 * (one atomic POST), so abandoning the page leaves nothing behind.
 */
export default function NewWorkoutPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.push('/');
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />
      <main>
        <div className="max-w-md mx-auto px-4 pt-6">
          <h1 className="text-xl font-bold text-gray-900">Log Past Workout</h1>
          <p className="text-sm text-gray-500 mb-2">Record a session you already did.</p>
        </div>
        <WorkoutEditorScreen mode="manual" currentUserId={user.id} />
      </main>
    </div>
  );
}
