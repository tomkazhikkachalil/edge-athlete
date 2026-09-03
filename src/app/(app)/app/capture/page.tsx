'use client';

/**
 * The light capture page (Sep 3 2026). On an older iPhone, opening the native
 * camera from the feed composer came back to a reloaded page and a lost photo
 * — iOS discards a heavy page's process while the camera is up. The feed is
 * heavy by nature (an unbounded post list, decoded images, live channels);
 * this page is deliberately almost nothing: the brand bar, two buttons, and
 * the same validate → stash pipeline the composer uses. The photo is stashed
 * (capture-stash.ts) and the feed opens the composer straight into the editor
 * on it (`/feed?create=1&restore=1`).
 *
 * Reached from the composer's capture-failure notice and by URL; if the
 * device pass proves it out, iOS composers route their camera buttons here.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import BrandBar from '@/components/BrandBar';
import CaptureInputs from '@/components/media/CaptureInputs';
import { validateFiles } from '@/lib/media/validation';
import { appendStashedCaptures, COMPOSER_STASH_KEY } from '@/lib/media/capture-stash';
import {
  armCapture,
  describeCaptureOutcome,
  disarmCapture,
  isAnomalousOutcome,
  readCaptureOutcome,
  type CaptureOutcome,
} from '@/lib/media/capture-diag';

const MAX_BYTES = 50 * 1024 * 1024;
const MAX_FILES = 10;

export default function CapturePage() {
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const router = useRouter();
  const { showError } = useToast();
  const [busy, setBusy] = useState(false);
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

  const handleFiles = async (files: FileList) => {
    disarmCapture();
    const { accepted, rejected } = validateFiles(Array.from(files), {
      maxBytes: MAX_BYTES,
      allowVideo: true,
      maxCount: MAX_FILES,
    });
    for (const r of rejected) showError('File not added', r.message);
    if (accepted.length === 0) return;
    setBusy(true);
    await appendStashedCaptures(COMPOSER_STASH_KEY, accepted);
    router.push('/feed?create=1&restore=1');
  };

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
            A lighter page for the camera. Your photo opens in the editor on your feed.
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
                  disabled={busy}
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
                  disabled={busy}
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
          {busy && <p className="mt-4 text-sm text-secondary">Saving your photo…</p>}
        </div>
      </main>
    </div>
  );
}
