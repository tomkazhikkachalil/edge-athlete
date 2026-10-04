'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@/lib/auth';
import { useNotifications } from '@/lib/notifications';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import { closeShownNotifications, setIconBadge, syncPush } from '@/lib/push/client';

// ── The app icon's number, kept in step from inside the app (mig 248) ──────
// While the app is CLOSED the service worker sets the number from each push.
// While it is OPEN, this keeps it equal to the bell: read something here and
// the icon's number drops with it. Mounted once at the root (beside the tab
// bar); renders nothing.
//
// It also runs the device's push sync once per signed-in session: the server
// gets this device's current endpoint (push services rotate them), and a
// device that chose on for this account but lost its subscription is
// subscribed again — silently, never a prompt (src/lib/push/client.ts).
//
// And when the bell reaches zero, whatever the phone's notification center
// still shows for this app is closed — read is read, wherever it happened.

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
    if (!signedIn || unreadCount !== 0) return;
    void closeShownNotifications({ all: true });
  }, [signedIn, unreadCount]);

  useEffect(() => {
    if (!signedIn || !user || syncedFor.current === user.id) return;
    syncedFor.current = user.id;
    void syncPush(user.id);
  }, [signedIn, user]);

  return null;
}
