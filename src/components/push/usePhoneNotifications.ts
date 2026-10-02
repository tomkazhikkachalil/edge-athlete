'use client';

import { useCallback, useEffect, useState } from 'react';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import {
  currentSubscription,
  disablePush,
  enablePush,
  loadPushConfig,
  pushSupport,
  type EnableResult,
  type PushSupport,
} from '@/lib/push/client';

// ── Phone notifications on THIS device: the state every door reads ─────────
// Settings → Notifications and the feed's one-time card both use this, so
// they can never disagree about whether the device is on.

export interface PhoneNotifications {
  /** The browser has been read and the deployment's config is known. */
  ready: boolean;
  /** The deployment holds the keys — without them no door shows. */
  offered: boolean;
  support: PushSupport;
  /** This device is subscribed. */
  on: boolean;
  busy: boolean;
  turnOn: () => Promise<EnableResult>;
  turnOff: () => Promise<void>;
}

export function usePhoneNotifications(): PhoneNotifications {
  const { mode } = useInstallApp();
  const [offered, setOffered] = useState<boolean | null>(null);
  const [on, setOn] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [support, setSupport] = useState<PushSupport>('unsupported');

  const isIos = mode === 'ios-safari' || mode === 'ios-browser' || mode === 'ios-in-app';
  const standalone = mode === 'installed';

  useEffect(() => {
    if (mode === null) return;
    let cancelled = false;
    (async () => {
      const [config, sub] = await Promise.all([loadPushConfig(), currentSubscription()]);
      if (cancelled) return;
      setOffered(config.enabled);
      setOn(sub !== null);
      setSupport(pushSupport({ isIos, standalone }));
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, isIos, standalone]);

  const turnOn = useCallback(async () => {
    setBusy(true);
    try {
      const result = await enablePush();
      setSupport(pushSupport({ isIos, standalone }));
      if (result === 'on') setOn(true);
      return result;
    } finally {
      setBusy(false);
    }
  }, [isIos, standalone]);

  const turnOff = useCallback(async () => {
    setBusy(true);
    try {
      await disablePush();
      setOn(false);
    } finally {
      setBusy(false);
    }
  }, []);

  return {
    ready: offered !== null && on !== null,
    offered: offered === true,
    support,
    on: on === true,
    busy,
    turnOn,
    turnOff,
  };
}
