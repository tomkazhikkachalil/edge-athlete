'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { adoptServerThemePrefs, useTheme } from '@/lib/use-theme';

/**
 * Bridges the account's stored theme (profiles.theme_prefs) into the device.
 * Renders nothing; mounted once in the root layout so the useTheme singleton
 * keeps its listeners (interval / visibility / storage / matchMedia) alive
 * app-wide.
 *
 * Server wins: when the signed-in user's OWN profile arrives, its prefs
 * overwrite the localStorage mirror — that is what makes the preference sync
 * across devices. Keyed off `profile` (self), NEVER activeProfile: a
 * guardian switching into a managed athlete keeps their own theme.
 * Signed-out visitors keep the device's last-known mirror.
 */
export default function ThemeApplier() {
  const { profile } = useAuth();
  useTheme();

  useEffect(() => {
    if (profile) adoptServerThemePrefs(profile.theme_prefs);
  }, [profile]);

  return null;
}
