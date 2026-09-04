'use client';

/**
 * In-app camera — a FALLBACK for a broken native picker, never the primary
 * path (Sep 3 2026, rounds 10–11 of the phone camera incident).
 *
 * The composer's "Take photo" / "Record video" open the device camera through
 * `<input capture>` (CaptureInputs) because it delivers the full sensor — that
 * rule stands. On an iPhone 12 Pro Max on iOS 26.6 the native picker's PHOTO
 * capture failed inside iOS's own screen, so this gives the phone a path that
 * never enters that screen: a camera stream in the page, a shutter (one frame
 * → canvas → JPEG File) and a Record mode (MediaRecorder → MP4 on WebKit,
 * WebM elsewhere — both server-allowed). Results go through the SAME
 * validate → attach → upload pipeline as a picked file.
 *
 * CAPTURE V2 HARDENING: on that same phone the first version sat on
 * "Starting camera…" forever — the OS never answered the stream request — and
 * closing it sometimes froze the app. So: every await here has a deadline
 * (stream 8s, first frame 5s, play 3s) and ends in a visible error instead of
 * a spinner; teardown is synchronous (pause → srcObject = null → stop every
 * track), never awaited; a stream that resolves after we gave up stops
 * itself. A camera the OS will not start still cannot be fixed from a web
 * page — the error says so and points at the device camera / a restart.
 *
 * Quality: stream stills and clips are video-frame resolution (up to 4K),
 * below the native 12MP. Acceptable for a fallback; the copy says so.
 * Floor: getUserMedia since iOS 11, MediaRecorder since iOS 14.3 — the whole
 * feature is gated by `canUseInAppCamera()` / `isTypeSupported`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

export type CameraFacing = 'environment' | 'user';
export type CameraMode = 'photo' | 'video';

const STREAM_TIMEOUT_MS = 8000;
const FIRST_FRAME_TIMEOUT_MS = 5000;
const PLAY_TIMEOUT_MS = 3000;
export const MAX_RECORD_SECONDS = 60;

const START_FAILED =
  'The camera did not start. Use the device camera (Take photo / Record video), or restart the phone and try again.';

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

/** The first MediaRecorder container this browser can write, or null. Exported for the test. */
export function pickRecordingMime(): string | null {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return null;
  const candidates = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* next */
    }
  }
  return null;
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
    case 'TimeoutError':
      return START_FAILED;
    default:
      return err instanceof Error && err.message ? err.message : START_FAILED;
  }
}

class TimeoutError extends Error {
  constructor(what: string) {
    super(what);
    this.name = 'TimeoutError';
  }
}

function withDeadline<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(what)), ms);
    p.then(
      v => { clearTimeout(timer); resolve(v); },
      e => { clearTimeout(timer); reject(e); }
    );
  });
}

function stopStream(video: HTMLVideoElement | null, stream: MediaStream | null): void {
  try {
    if (video) {
      video.pause();
      video.srcObject = null;
    }
  } catch {
    /* teardown must never throw */
  }
  stream?.getTracks().forEach(t => {
    try {
      t.stop();
    } catch {
      /* ignore */
    }
  });
}

interface InAppCameraProps {
  onCapture: (file: File) => void;
  onClose: () => void;
  initialFacing?: CameraFacing;
  initialMode?: CameraMode;
  /** Diagnostic hook: the stream's frame size once known. */
  onStreamReady?: (width: number, height: number, facing: CameraFacing) => void;
}

export default function InAppCamera({
  onCapture,
  onClose,
  initialFacing = 'environment',
  initialMode = 'photo',
  onStreamReady,
}: InAppCameraProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [facing, setFacing] = useState<CameraFacing>(initialFacing);
  const [mode, setMode] = useState<CameraMode>(initialMode);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recordingMime = mode === 'video' ? pickRecordingMime() : null;

  // Start (and on flip / mode change, restart) the stream with deadlines.
  // Every state write happens after an await or in an event handler.
  useEffect(() => {
    let cancelled = false;
    const video = videoRef.current;
    void (async () => {
      try {
        const wantAudio = mode === 'video';
        const relaxed: MediaStreamConstraints = {
          audio: wantAudio,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        };
        let stream: MediaStream;
        try {
          stream = await withDeadline(navigator.mediaDevices.getUserMedia(relaxed), STREAM_TIMEOUT_MS, 'stream');
        } catch (first) {
          if (first instanceof Error && first.name === 'OverconstrainedError') {
            stream = await withDeadline(
              navigator.mediaDevices.getUserMedia({ audio: wantAudio, video: { facingMode: { ideal: facing } } }),
              STREAM_TIMEOUT_MS,
              'stream'
            );
          } else if (wantAudio) {
            // A microphone that is denied, missing, or stuck behind a prompt
            // must not cost the camera: record without sound instead.
            stream = await withDeadline(
              navigator.mediaDevices.getUserMedia({ audio: false, video: relaxed.video }),
              STREAM_TIMEOUT_MS,
              'stream'
            );
          } else throw first;
        }
        if (cancelled || !video) {
          stopStream(null, stream);
          return;
        }
        streamRef.current = stream;
        const firstFrame = new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => resolve();
          video.onerror = () => reject(new Error('The camera stream could not be displayed.'));
        });
        video.srcObject = stream;
        await withDeadline(firstFrame, FIRST_FRAME_TIMEOUT_MS, 'first frame');
        await withDeadline(video.play(), PLAY_TIMEOUT_MS, 'play').catch(() => {
          /* autoplay policies — the stream still renders once metadata loads */
        });
        if (cancelled) return;
        if (video.videoWidth > 0) {
          setReady(true);
          onStreamReady?.(video.videoWidth, video.videoHeight, facing);
        } else {
          setError(START_FAILED);
        }
      } catch (err) {
        if (!cancelled) setError(describeCameraError(err));
      }
    })();
    return () => {
      cancelled = true;
      stopStream(video, streamRef.current);
      streamRef.current = null;
    };
    // onStreamReady is a diagnostic hook; re-running the stream on its identity would flicker the camera.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing, mode]);

  // Escape closes; recording stops with the component.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
      try {
        if (recorderRef.current && recorderRef.current.state !== 'inactive') recorderRef.current.stop();
      } catch {
        /* ignore */
      }
    };
  }, [onClose]);

  const restart = (next: { facing?: CameraFacing; mode?: CameraMode }) => {
    setReady(false);
    setError(null);
    if (next.facing) setFacing(next.facing);
    if (next.mode) setMode(next.mode);
  };

  const capturePhoto = useCallback(async () => {
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
      const blob = await withDeadline(
        new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92)),
        FIRST_FRAME_TIMEOUT_MS,
        'encode'
      );
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

  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    const mime = pickRecordingMime();
    if (!stream || !mime || recording) return;
    try {
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks: BlobPart[] = [];
      const startedAt = Date.now();
      recorder.ondataavailable = e => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };
      recorder.onerror = () => {
        setRecording(false);
        setError('Recording failed. Use the device camera instead.');
      };
      recorder.onstop = () => {
        if (recordTimerRef.current) clearTimeout(recordTimerRef.current);
        setRecording(false);
        const container = (recorder.mimeType || mime).split(';')[0] || 'video/webm';
        const blob = new Blob(chunks, { type: container });
        if (blob.size === 0) {
          setError('Nothing was recorded. Try again, or use the device camera.');
          return;
        }
        const ext = container === 'video/mp4' ? 'mp4' : 'webm';
        const now = Date.now();
        onCapture(new File([blob], `camera-${now}.${ext}`, { type: container, lastModified: now }));
      };
      recorderRef.current = recorder;
      recorder.start(1000);
      setRecording(true);
      setElapsed(0);
      const tick = () => {
        const s = Math.round((Date.now() - startedAt) / 1000);
        setElapsed(s);
        if (s >= MAX_RECORD_SECONDS) {
          try {
            recorder.stop();
          } catch {
            /* ignore */
          }
          return;
        }
        recordTimerRef.current = setTimeout(tick, 500);
      };
      recordTimerRef.current = setTimeout(tick, 500);
    } catch (err) {
      setError(describeCameraError(err));
    }
  }, [onCapture, recording]);

  const stopRecording = useCallback(() => {
    try {
      recorderRef.current?.stop();
    } catch {
      setRecording(false);
    }
  }, []);

  const closeNow = () => {
    // Synchronous teardown BEFORE the parent unmounts us — never awaited.
    stopStream(videoRef.current, streamRef.current);
    streamRef.current = null;
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="In-app camera"
      className="fixed inset-0 z-[65] bg-black flex flex-col safe-top safe-bottom"
    >
      <div className="flex items-center justify-between px-3 py-2 text-white">
        <button type="button" onClick={closeNow} className="min-h-[44px] px-3 rounded-full text-sm font-semibold hover:bg-white/10">
          Cancel
        </button>
        <div role="group" aria-label="Camera mode" className="flex rounded-full bg-white/10 p-0.5 text-xs font-semibold">
          <button
            type="button"
            aria-pressed={mode === 'photo'}
            disabled={recording}
            onClick={() => mode !== 'photo' && restart({ mode: 'photo' })}
            className={`min-h-[36px] px-3 rounded-full ${mode === 'photo' ? 'bg-white text-black' : ''}`}
          >
            Photo
          </button>
          <button
            type="button"
            aria-pressed={mode === 'video'}
            disabled={recording}
            onClick={() => mode !== 'video' && restart({ mode: 'video' })}
            className={`min-h-[36px] px-3 rounded-full ${mode === 'video' ? 'bg-white text-black' : ''}`}
          >
            Video
          </button>
        </div>
        <button
          type="button"
          disabled={recording}
          onClick={() => restart({ facing: facing === 'environment' ? 'user' : 'environment' })}
          className="min-h-[44px] px-3 rounded-full text-sm font-semibold hover:bg-white/10 disabled:opacity-40"
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
          className={`max-h-full max-w-full object-contain ${facing === 'user' ? 'scale-x-[-1]' : ''}`}
        />
        {!ready && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-white/80 text-sm" aria-live="polite">
            Starting camera… (gives up after {Math.round(STREAM_TIMEOUT_MS / 1000)}s)
          </div>
        )}
        {recording && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 rounded-full bg-red-600 text-white text-xs font-semibold px-3 py-1" aria-live="polite">
            ● {elapsed}s / {MAX_RECORD_SECONDS}s
          </div>
        )}
        {error && (
          <div className="absolute inset-x-4 top-4 rounded-lg bg-white/95 text-primary p-3 text-sm" role="alert">
            <p>{error}</p>
            <button type="button" onClick={closeNow} className="mt-2 min-h-[44px] px-3 rounded-full bg-brand text-white text-sm font-semibold">
              Try the device camera instead
            </button>
          </div>
        )}
      </div>

      <div className="flex flex-col items-center gap-2 py-4">
        {mode === 'photo' ? (
          <button
            type="button"
            onClick={() => void capturePhoto()}
            disabled={!ready || busy || !!error}
            aria-label="Capture photo"
            className="h-[72px] w-[72px] rounded-full border-4 border-white bg-white/20 disabled:opacity-40"
          />
        ) : recording ? (
          <button
            type="button"
            onClick={stopRecording}
            aria-label="Stop recording"
            className="h-[72px] w-[72px] rounded-full border-4 border-white bg-red-600 flex items-center justify-center"
          >
            <span className="block h-6 w-6 bg-white rounded-sm" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            onClick={startRecording}
            disabled={!ready || !!error || !recordingMime}
            aria-label="Start recording"
            className="h-[72px] w-[72px] rounded-full border-4 border-white flex items-center justify-center disabled:opacity-40"
          >
            <span className="block h-8 w-8 rounded-full bg-red-600" aria-hidden="true" />
          </button>
        )}
        <p className="px-6 text-center text-xs text-white/70">
          {mode === 'video' && !recordingMime && ready
            ? 'Recording is not supported in this browser — use the device camera for video.'
            : 'In-app photos and clips are video-frame resolution. The device camera is higher quality when it works.'}
        </p>
      </div>
    </div>
  );
}
