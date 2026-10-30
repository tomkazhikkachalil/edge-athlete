'use client';

import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { adoptAccountUnitSystem } from '@/hooks/useUnitSystem';

/**
 * Bridges the account's stored unit system (profiles.unit_system, 293) into
 * the device, the way ThemeApplier bridges the theme. Renders nothing;
 * mounted once in the app's root layout.
 *
 * Server wins: when the signed-in user's OWN profile arrives, its choice
 * overwrites the device cache — that is what makes the choice follow the
 * person across devices. Keyed off `profile` (self), NEVER activeProfile: a
 * guardian switching into a managed athlete keeps their own units. A profile
 * with no choice yet leaves the device's value standing.
 */
export default function UnitSystemApplier() {
  const { profile } = useAuth();

  useEffect(() => {
    if (profile) adoptAccountUnitSystem(profile.unit_system);
  }, [profile]);

  return null;
}
