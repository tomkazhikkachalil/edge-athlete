'use client';

/**
 * The light capture page (Sep 3 2026). On an older iPhone, opening the native
 * camera from the feed composer came back to a reloaded page and a lost photo
 * — iOS discards a heavy page's process while the camera is up. The feed is
 * heavy by nature (an unbounded post list, decoded images, live channels);
 * this page starts as almost nothing: the brand bar and two buttons.
 *
 * ROUND 7 — THE PHOTO NEVER LEAVES THIS PAGE. The first version stashed the
 * capture in IndexedDB and navigated to `/feed?create=1&restore=1`, where the
 * composer read it back. On Tom's iOS 15 phone that hand-off failed silently
 * at the storage step (the stash is fail-open by design): the feed came back,
 * the composer opened, no photo, no editor — while library picks, which skip
 * the hand-off, worked. So the composer is HOSTED HERE: once the camera hands
 * files back, this page mounts CreatePostModal with `initialCaptures`, the
 * editor opens on them from memory, and the post is created from this page.
 * The feed is only the destination after the post exists. The stash is still
 * written (fire-and-forget) purely as crash recovery: if the editor's decode
 * reloads the tab, the feed composer offers the photo back.
 *
 * iOS composers route their camera buttons here (platform.ts isIOSWebKit);
 * the composer's capture-failure notice links here too.
 */

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import BrandBar from '@/components/BrandBar';
import CaptureInputs from '@/components/media/CaptureInputs';
import { validateFiles } from '@/lib/media/validation';
import { appendStashedCaptures, COMPOSER_STASH_KEY } from '@/lib/media/capture-stash';
import { resolveSportKey, isComposerSport } from '@/lib/sports/resolve-sport-key';
import {
  armCapture,
  describeCaptureOutcome,
  disarmCapture,
  isAnomalousOutcome,
  readCaptureOutcome,
  type CaptureOutcome,
} from '@/lib/media/capture-diag';

// Same lazy chunk the feed uses; it loads only after a capture exists, so the
// page the camera opens FROM stays light.
const CreatePostModal = dynamic(() => import('@/components/CreatePostModal'), { ssr: false });

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;

export default function CapturePage() {
  const { user, profile, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const { showError } = useToast();
  // The camera's files, held in memory — mounting the composer on them.
  const [captured, setCaptured] = useState<File[] | null>(null);
  // Lazy read (browser-only page): an armed record from a previous boot of
  // THIS page means the camera reloaded even the light page.
  const [outcome] = useState<CaptureOutcome | null>(() => {
    const found = readCaptureOutcome();
    if (found && isAnomalousOutcome(found)) return found;
    if (found) disarmCapture();
    return null;
  });

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  const handleFiles = (files: FileList) => {
    disarmCapture();
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_FILES,
    });
    for (const r of rejected) showError('File not added', r.message);
    if (accepted.length === 0) return;
    // Crash recovery only — never awaited, never on the path to the editor.
    void appendStashedCaptures(COMPOSER_STASH_KEY, accepted);
    setCaptured(accepted);
  };

  const profileSportKey = resolveSportKey(profile?.sport);

  if (loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-brand-soft">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" aria-label="Loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <main className="flex-grow flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-surface rounded-lg shadow-lg p-6 sm:p-8 text-center">
          <h1 className="text-2xl font-bold text-primary">Take a photo</h1>
          <p className="mt-3 text-secondary">
            A lighter page for the camera. Your photo opens in the editor right here.
          </p>
          {outcome && (
            <p role="status" className="mt-4 rounded-lg bg-brand-soft px-3 py-2 text-sm text-violet-900 dark:text-violet-200">
              The camera closed without returning a photo
              {outcome.reloaded ? ' — Safari reloaded this page.' : '.'}
              <span className="block mt-1 font-mono text-xs text-muted">{describeCaptureOutcome(outcome)}</span>
            </p>
          )}
          <CaptureInputs onFiles={handleFiles} allowVideo>
            {({ openPhoto, openVideo }) => (
              <div className="mt-6 flex flex-col gap-3">
                <button
                  type="button"
                  disabled={captured !== null}
                  onClick={() => {
                    armCapture('capture-page');
                    openPhoto();
                  }}
                  className="ea-cta min-h-[52px] rounded-lg text-white font-semibold disabled:opacity-50"
                >
                  Take photo
                </button>
                <button
                  type="button"
                  disabled={captured !== null}
                  onClick={() => {
                    armCapture('capture-page');
                    openVideo?.();
                  }}
                  className="min-h-[52px] rounded-lg border border-border-strong text-primary font-semibold hover:bg-brand-soft disabled:opacity-50"
                >
                  Record video
                </button>
              </div>
            )}
          </CaptureInputs>
        </div>
      </main>
      {/* Mounted only once the camera has handed files back: `initialCaptures`
          seeds the editor at mount. Closing without posting returns to the
          two buttons (retake); a created post lands on the feed. */}
      {captured && (
        <CreatePostModal
          isOpen
          onClose={() => setCaptured(null)}
          userId={user.id}
          initialCaptures={captured}
          onPostCreated={() => router.push('/feed')}
          defaultSportKey={isComposerSport(profileSportKey) ? profileSportKey : 'general'}
        />
      )}
    </div>
  );
}
