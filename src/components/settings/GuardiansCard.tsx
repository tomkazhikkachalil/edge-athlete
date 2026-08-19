'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials } from '@/lib/formatters';

// ── Your guardians ────────────────────────────────────────────────────────────
// The custody link, visible from the athlete's end: who manages this profile.
// A relationship visible from only one side goes invisible the moment it
// matters — this card is the other side. Renders nothing for unsupervised
// profiles or when the list is empty.

interface Guardian {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  since: string | null;
}

export default function GuardiansCard() {
  const { profile } = useAuth();
  const [guardians, setGuardians] = useState<Guardian[]>([]);

  const supervised =
    FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES &&
    profile?.supervision_state === 'supervised';

  useEffect(() => {
    if (!supervised) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/profile/guardians');
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setGuardians(data.guardians ?? []);
      } catch {
        // The card is informational — its absence must never break settings.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supervised]);

  if (!supervised || guardians.length === 0) return null;

  return (
    <div className="bg-brand-soft border border-violet-200 dark:border-violet-900 rounded-lg p-4 mb-6">
      <h3 className="text-sm font-bold text-primary mb-1">Your guardians</h3>
      <p className="text-xs text-tertiary mb-3">
        These people manage your profile — its privacy, what gets posted, and
        who can contact you — until the account is handed over to you.
      </p>
      <ul className="space-y-2">
        {guardians.map(g => {
          const name = formatDisplayName(g.first_name, null, g.last_name, g.display_name);
          return (
            <li key={g.id} className="flex items-center gap-3">
              <div className="relative w-8 h-8 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                {g.avatar_url ? (
                  <Image
                    src={g.avatar_url}
                    alt=""
                    fill
                    sizes="32px"
                    className="object-cover"
                    unoptimized={!isOptimizableImageSrc(g.avatar_url)}
                  />
                ) : (
                  <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-primary truncate">{name}</p>
                <p className="text-xs text-muted">
                  Guardian
                  {g.since && ` · since ${new Date(g.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
