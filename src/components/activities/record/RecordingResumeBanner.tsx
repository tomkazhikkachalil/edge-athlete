'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import { openRecordingStore, type RecordingMeta } from '@/lib/activities/record/storage';

/**
 * Vitals' twin of the workout resume banner (Live Activities): a recording
 * this phone did not finish is offered where the athlete lands — the
 * recorder page itself offers the same on open. Reads the device's store
 * once; renders nothing where there is none (or no IndexedDB).
 */
export default function RecordingResumeBanner() {
  const router = useRouter();
  const { user, activeProfile } = useAuth();
  const profileId = activeProfile?.id ?? user?.id ?? null;
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  useEffect(() => {
    if (!profileId) return;
    let live = true;
    const store = openRecordingStore();
    if (!store) return;
    void store
      .findUnfinished(profileId, Date.now())
      .then(found => {
        if (live) setMeta(found);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [profileId]);
  if (!meta) return null;
  const label = ACTIVITY_TYPE_DEFS[meta.type]?.label.toLowerCase() ?? 'activity';
  return (
    <div className="mt-4 flex items-center justify-between gap-3 px-4 py-3 bg-brand-soft border border-brand/40 rounded-xl" data-vitals-recording-resume>
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse shrink-0" aria-hidden="true" />
        <p className="text-sm text-primary truncate">
          <span className="font-bold">A {label} is waiting on this phone</span>
          {meta.status === 'finished' ? ' — not saved yet' : ' — paused'}
        </p>
      </div>
      <button type="button" onClick={() => router.push('/activities/record')} className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-bold hover:bg-brand-hover transition-colors shrink-0">
        Resume
      </button>
    </div>
  );
}
