'use client';

/**
 * In-app camera — a FALLBACK for a broken native photo picker, never the
 * primary path (Sep 3 2026, round 10 of the phone camera incident).
 *
 * The composer's "Take photo" opens the device camera through
 * `<input capture>` (CaptureInputs) because it delivers the full sensor — that
 * rule stands. But on an iPhone 12 Pro Max on iOS 26.6 the picker's PHOTO
 * capture failed inside iOS's own screen (a black preview, then "Use Photo"
 * handed nothing back) while its VIDEO capture kept working; Apple's forums
 * document the same system-level failure from iOS 18.4. Nothing a web page
 * does reaches that screen, so this component gives the phone a photo path
 * that never enters it: a camera stream in the page, a shutter, one frame
 * drawn to a canvas and handed back as a JPEG File through the SAME
 * validate → editor → upload pipeline as a picked file.
 *
 * Quality: a stream still is video-frame resolution (up to 4K on that phone),
 * below the native 12MP. Acceptable for a fallback; the copy says so.
 *
 * Floor: getUserMedia has shipped since iOS 11; the whole feature is gated by
 * `canUseInAppCamera()` (touch device + mediaDevices present), so a browser
 * without it never sees the affordance. Every track is stopped on close and
 * on unmount. Same layer as the media editor (fixed, z-[65], no portal —
 * the editor's proven pattern).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraFacing = 'environment' | 'user';

/** Touch device with a camera stream API — the only case the fallback is offered. */
export function canUseInAppCamera(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    navigator.maxTouchPoints > 1 &&
    !!navigator.mediaDevices &&
    typeof navigator.mediaDevices.getUserMedia === 'function'
  );
}

/** Any camera stream API at all — the diagnostic page offers the shutter on desktops too. */
export function hasCameraStreamApi(): boolean {
  if (typeof navigator === 'undefined') return false;
  return !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function';
}

function describeCameraError(err: unknown): string {
  const name = err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera access is blocked for this browser. Allow it in Settings, or use the device camera.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found for this side. Try flipping the camera.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is in use or unavailable. Close other apps using it and try again.';
    default:
      return err instanceof Error && err.message ? err.message : 'The camera could not be started.';
  }
}

interface InAppCameraProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  initialFacing?: CameraFacing;
  /** Diagnostic hook: the stream's frame size once known. */
  onStreamReady?: (width: number, height: number, facing: CameraFacing) => void;
}

export default function InAppCamera({
  onCapture,
  onClose,
  initialFacing = 'environment',
  onStreamReady,
}: InAppCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Start (and on flip, restart) the stream. All state writes happen after an
  // await or in event handlers — nothing synchronous inside the effect.
  useEffect(() => {
    let cancelled = false;
    const stop = () => {
      streamRef.current?.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    };
    void (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: facing, width: { ideal: 4096 }, height: { ideal: 4096 } },
        });
        if (cancelled) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => {
            /* autoplay policies — the stream still renders once metadata loads */
          });
        }
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err));
      }
    })();
    return () => {
      cancelled = true;
      stop();
    };
  }, [facing]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleLoaded = () => {
    const video = videoRef.current;
    if (!video) return;
    setReady(video.videoWidth > 0);
    if (video.videoWidth > 0) onStreamReady?.(video.videoWidth, video.videoHeight, facing);
  };

  const capture = useCallback(async () => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0 || busy) return;
    setBusy(true);
    const canvas = document.createElement('canvas');
    try {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('No 2D canvas context');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
      if (!blob) throw new Error('The photo could not be encoded');
      // Safari may hand back PNG when it lacks a JPEG encoder — trust the bytes.
      const mime = blob.type || 'image/jpeg';
      const ext = mime === 'image/png' ? 'png' : 'jpg';
      const now = Date.now();
      onCapture(new File([blob], `camera-${now}.${ext}`, { type: mime, lastModified: now }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The photo could not be captured');
      setBusy(false);
    } finally {
      canvas.width = 0;
      canvas.height = 0;
    }
  }, [busy, onCapture]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="In-app camera"
      className="fixed inset-0 z-[65] bg-black flex flex-col safe-top safe-bottom"
    >
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button type="button" onClick={onClose} className="min-h-[44px] px-3 rounded-full text-sm font-semibold hover:bg-white/10">
          Cancel
        </button>
        <span className="text-sm font-semibold">In-app camera</span>
        <button
          type="button"
          onClick={() => {
            setReady(false);
            setError(null);
            setFacing(f => (f === 'environment' ? 'user' : 'environment'));
          }}
          className="min-h-[44px] px-3 rounded-full text-sm font-semibold hover:bg-white/10"
          aria-label="Flip camera"
        >
          <i className="fas fa-sync-alt" aria-hidden="true"></i>
        </button>
      </div>

      <div className="flex-1 min-h-0 relative flex items-center justify-center">
        <video
          ref={videoRef}
          data-testid="in-app-camera-video"
          autoPlay
          playsInline
          muted
          onLoadedMetadata={handleLoaded}
          className={`max-h-full max-w-full object-contain ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm">
            Starting camera…
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-lg bg-white/95 text-primary p-3 text-sm" role="alert">
            <p>{error}</p>
            <button type="button" onClick={onClose} className="mt-2 min-h-[44px] px-3 rounded-full bg-brand text-white text-sm font-semibold">
              Try the device camera instead
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 py-4">
        <button
          type="button"
          onClick={() => void capture()}
          disabled={!ready || busy || !!error}
          aria-label="Capture photo"
          className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
        />
        <p className="px-6 text-center text-xs text-white/70">
          In-app photos are video-frame resolution. The device camera is higher quality when it works.
        </p>
      </div>
    </div>
  );
}
