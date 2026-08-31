'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function ProfileRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Redirect to current athlete page until we migrate fully
    router.replace('/athlete');
  }, [router]);

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
        <p className="mt-2 text-tertiary">Redirecting to profile...</p>
      </div>
    </div>
  );
}