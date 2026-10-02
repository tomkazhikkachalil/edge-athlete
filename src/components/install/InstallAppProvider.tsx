'use client';

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { getSnapshot, parseSnapshot, showInstallPrompt, subscribe } from '@/lib/install/store';
import type { InstallMode } from '@/lib/install/platform';

// ── Download the app (Oct 2026) ─────────────────────────────────────────────
// Tom: people should be able to put Edge Athlete on their phone as an icon
// and open it like any app — every feature, no store. The web manifest
// already made that POSSIBLE; nothing told anyone, and nothing knew whether
// it had happened. This is the one root-mounted home for it (the Edit
// Profile host's shape):
//
//   const app = useInstallApp();
//   app.canInvite   // show a "Download the app" door here?
//   app.install();  // Android / desktop Chromium: the browser's one-tap
//                   // install. Everything else: the guide, opened over the
//                   // page the person is on.
//
// The rule for what a device can do is src/lib/install/platform.ts; the live
// browser signals are src/lib/install/store.ts. There is NO service worker —
// installing needs none. Offline and push are their own later rounds (a
// worker also needs `worker-src 'self'` in buildCsp first).

const InstallAppSheet = dynamic(() => import('./InstallAppSheet'), { ssr: false });

interface InstallAppApi {
  /** Null until the browser has been read (the server render, hydration). */
  mode: InstallMode | null;
  /** Installed on this device, though this window is a browser tab. */
  knownInstalled: boolean;
  /** A phone or a tablet. */
  handheld: boolean;
  /** There is something to invite this person to do. */
  canInvite: boolean;
  install: () => void;
  openGuide: () => void;
}

const NOOP: InstallAppApi = {
  mode: null,
  knownInstalled: false,
  handheld: false,
  canInvite: false,
  install: () => {},
  openGuide: () => {},
};
const InstallAppContext = createContext<InstallAppApi>(NOOP);

export function useInstallApp(): InstallAppApi {
  return useContext(InstallAppContext);
}

const serverSnapshot = () => null;

export function InstallAppProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore<string | null>(subscribe, getSnapshot, serverSnapshot);
  const state = useMemo(() => parseSnapshot(snapshot), [snapshot]);
  const pathname = usePathname();
  const [guideOpen, setGuideOpen] = useState(false);

  // A root-mounted pop-up outlives the page under it: a route change closes
  // it. Render-phase state sync — the house idiom (EditProfileHost).
  const [seenPath, setSeenPath] = useState(pathname);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    if (guideOpen) setGuideOpen(false);
  }

  const openGuide = useCallback(() => setGuideOpen(true), []);
  const closeGuide = useCallback(() => setGuideOpen(false), []);
  const mode = state?.mode ?? null;
  const install = useCallback(() => {
    if (mode !== 'prompt') {
      setGuideOpen(true);
      return;
    }
    void showInstallPrompt().then((shown) => {
      if (!shown) setGuideOpen(true);
    });
  }, [mode]);

  const api = useMemo<InstallAppApi>(
    () => ({
      mode,
      knownInstalled: state?.knownInstalled ?? false,
      handheld: state?.handheld ?? false,
      canInvite: mode !== null && mode !== 'installed' && !(state?.knownInstalled ?? false),
      install,
      openGuide,
    }),
    [mode, state, install, openGuide]
  );

  return (
    <InstallAppContext.Provider value={api}>
      {children}
      {guideOpen && mode && <InstallAppSheet mode={mode} onClose={closeGuide} onInstall={install} />}
    </InstallAppContext.Provider>
  );
}
