'use client';

import { IFRAME_API_SRC, PLAYER_READY_TIMEOUT_MS } from './player-rules';

/**
 * YouTube's IFrame Player API, loaded once per page by TRUSTED code (Videos
 * program polish B, Nov 6 2026). The CSP's script-src carries
 * 'strict-dynamic': a <script> element created by already-trusted script
 * and appended to the document is trusted, and so is what it loads in turn
 * (the widget api). Nothing is parser-inserted, no host is added to the
 * policy. Resolves with the YT namespace, or rejects after the
 * timeout / on error — the caller then renders the plain frame as before.
 */

// The slice of the API this app uses — typed here, never a global d.ts.
export interface YTPlayer {
  getCurrentTime(): number;
  getDuration(): number;
  getPlayerState(): number;
  seekTo(seconds: number, allowSeekAhead: boolean): void;
  playVideo(): void;
  pauseVideo(): void;
  destroy(): void;
}
export interface YTNamespace {
  Player: new (el: HTMLElement, opts: {
    host?: string;
    videoId: string;
    playerVars?: Record<string, string | number>;
    events?: { onReady?: () => void; onStateChange?: (e: { data: number }) => void; onError?: () => void };
  }) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; PAUSED: number; BUFFERING: number; CUED: number; UNSTARTED: number };
}

declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

let pending: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (pending) return pending;
  pending = new Promise<YTNamespace>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending = null;
      reject(new Error('youtube api timeout'));
    }, PLAYER_READY_TIMEOUT_MS);
    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      clearTimeout(timer);
      previous?.();
      if (window.YT?.Player) resolve(window.YT);
      else {
        pending = null;
        reject(new Error('youtube api absent'));
      }
    };
    const script = document.createElement('script');
    script.src = IFRAME_API_SRC;
    script.async = true;
    script.onerror = () => {
      clearTimeout(timer);
      pending = null;
      reject(new Error('youtube api failed'));
    };
    document.head.appendChild(script);
  });
  return pending;
}
