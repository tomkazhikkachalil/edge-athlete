'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import { setIconBadge, syncPush } from '@/lib/push/client';

// ── The app icon's number, kept in step from inside the app (mig 248) ──────
// While the app is CLOSED the service worker sets the number from each push.
// While it is OPEN, this keeps it equal to the bell: read something here and
// the icon's number drops with it. Mounted once at the root (beside the tab
// bar); renders nothing.
//
// It also re-sends this device's subscription once per signed-in session when
// notifications are already allowed — push services rotate endpoints, and a
// stale one would stop the buzzing without anyone noticing. Never prompts.

export default function PushHost() {
  const { user, initialAuthCheckComplete } = useAuth();
  const { unreadCount } = useNotifications();
  const { mode } = useInstallApp();
  const syncedFor = useRef<string | null>(null);

  const signedIn = initialAuthCheckComplete && !!user;
  const installed = mode === 'installed';

  useEffect(() => {
    if (!signedIn || !installed) return;
    setIconBadge(unreadCount);
  }, [signedIn, installed, unreadCount]);

  useEffect(() => {
    if (!signedIn || !user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    void syncPush();
  }, [signedIn, user]);

  return null;
}
