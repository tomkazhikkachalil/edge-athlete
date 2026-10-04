'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import {
  currentSubscription,
  disablePush,
  enablePush,
  loadPushConfig,
  pushSupport,
  readDeviceChoice,
  rememberDeviceChoice,
  syncPush,
  type EnableResult,
  type PushSupport,
} from '@/lib/push/client';
import type { DeviceChoice } from '@/lib/push/card';

// ── Phone notifications on THIS device: the state every door reads ─────────
// Settings → Notifications and the feed's card both use this, so they can
// never disagree about whether the device is on. The device is read AFTER
// the boot repair (syncPush) has run, so a device that chose on and lost its
// subscription reads as on again — never as a device to ask.

export interface PhoneNotifications {
  /** The browser has been read and the deployment's config is known. */
  ready: boolean;
  /** The deployment holds the keys — without them no door shows. */
  offered: boolean;
  support: PushSupport;
  /** This device is subscribed. */
  on: boolean;
  /** What this account chose on this device, or null when never answered. */
  choice: DeviceChoice | null;
  busy: boolean;
  turnOn: () => Promise<EnableResult>;
  turnOff: () => Promise<void>;
}

export function usePhoneNotifications(): PhoneNotifications {
  const { user } = useAuth();
  const { mode } = useInstallApp();
  const userId = user?.id ?? null;
  const [offered, setOffered] = useState<boolean | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [choice, setChoice] = useState<DeviceChoice | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<PushSupport>('unsupported');

  const isIos = mode === 'ios-safari' || mode === 'ios-browser' || mode === 'ios-in-app';
  const standalone = mode === 'installed';

  useEffect(() => {
    if (mode === null) return;
    let cancelled = false;
    (async () => {
      // The repair first (one run per account per page load), then the read.
      if (userId) await syncPush(userId);
      const [config, sub] = await Promise.all([loadPushConfig(), currentSubscription()]);
      if (cancelled) return;
      setOffered(config.enabled);
      setOn(sub !== null);
      setChoice(readDeviceChoice(userId));
      setSupport(pushSupport({ isIos, standalone }));
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, isIos, standalone, userId]);

  const turnOn = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      setSupport(pushSupport({ isIos, standalone }));
      if (result === 'on') {
        setOn(true);
        if (userId) {
          rememberDeviceChoice(userId, 'on');
          setChoice('on');
        }
      }
      return result;
    } finally {
      setBusy(false);
    }
  }, [isIos, standalone, userId]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      setOn(false);
      if (userId) {
        rememberDeviceChoice(userId, 'off');
        setChoice('off');
      }
    } finally {
      setBusy(false);
    }
  }, [userId]);

  return {
    ready: offered !== null && on !== null,
    offered: offered === true,
    support,
    on: on === true,
    choice,
    busy,
    turnOn,
    turnOff,
  };
}
