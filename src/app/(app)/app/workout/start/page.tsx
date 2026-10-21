'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import WorkoutStartScreen from '@/components/workouts/WorkoutStartScreen';

/**
 * /app/workout/start — set up a workout before it starts (Program E2).
 * Nothing is written until Start; the tab bar is hidden under /app/workout/.
 */
export default function WorkoutStartPage() {
  const { user, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (initialAuthCheckComplete && !user) router.replace(`/?next=${encodeURIComponent('/app/workout/start')}`);
  }, [initialAuthCheckComplete, user, router]);
  if (!initialAuthCheckComplete || !user) return null;
  return <WorkoutStartScreen />;
}
