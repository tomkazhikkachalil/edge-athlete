'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import BrandBar from '@/components/BrandBar';
import { FEATURE_FLAGS } from '@/lib/features';
import Link from 'next/link';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { transferStateChip, type TransferState } from '@/lib/transfer-ui';

// ── Guardian transfers overview ──────────────────────────────────────────────
// One row per managed athlete with the state of their account handover.
// Rows link into the shared /app/transfer/[profileId] page where all the
// actions live.

interface ManagedAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  supervision_state: string | null;
  /** Rollup from /api/guardian/athletes — replaces the old per-athlete
   *  /api/transfers fan-out (one request per athlete, now zero). */
  activeTransfer: { state: TransferState } | null;
}

const CHIP_TONES = {
  violet: 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong',
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  gray: 'bg-surface-sunken text-tertiary',
} as const;

export default function GuardianTransfersPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [rows, setRows] = useState<ManagedAthlete[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  // Inlined cancellable IIFE. One request: the roster payload carries each
  // athlete's active transfer state (family-console rollup).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load your athletes');
        if (cancelled) return;
        setRows(data.athletes ?? []);
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your athletes');
      } finally {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-brand-soft flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-brand-soft">
      <BrandBar />
      <main className="flex-grow w-full max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/app/guardian"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold text-violet-800 dark:text-violet-200 mb-1">Account transfers</h1>
        <p className="text-sm text-tertiary mb-6">
          When an athlete is old enough, you can hand their account over to them.
          Nothing happens without both of you confirming, and there&apos;s always a
          7-day waiting period.
        </p>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : rows.length === 0 ? (
          <div className="text-sm text-muted bg-surface border border-border rounded-lg p-6 text-center">
            You&apos;re not supervising any athlete accounts.
          </div>
        ) : (
          rows.map(athlete => {
            const name = formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.display_name);
            const transferred = athlete.supervision_state === 'self';
            const chip = transferred
              ? { label: 'Transferred', tone: 'gray' as const }
              : athlete.activeTransfer
                ? transferStateChip(athlete.activeTransfer.state)
                : { label: 'Supervised', tone: 'gray' as const };
            const inner = (
              <>
                <div className="relative w-10 h-10 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                  {athlete.avatar_url ? (
                    <Image
                      src={athlete.avatar_url}
                      alt=""
                      fill
                      sizes="40px"
                      className="object-cover"
                      unoptimized={!isOptimizableImageSrc(athlete.avatar_url)}
                    />
                  ) : (
                    <span className="text-sm font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                  )}
                </div>
                <div className="flex-grow min-w-0 text-left">
                  <p className="text-sm font-semibold text-primary truncate">{name}</p>
                  {athlete.handle && <p className="text-xs text-muted truncate">@{athlete.handle}</p>}
                </div>
                <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${CHIP_TONES[chip.tone]}`}>
                  {chip.label}
                </span>
                {!transferred && <i className="fas fa-chevron-right text-gray-300 shrink-0"></i>}
              </>
            );
            return transferred ? (
              <div key={athlete.id} className="w-full bg-surface border border-border rounded-lg p-4 mb-3 flex items-center gap-3">
                {inner}
              </div>
            ) : (
              <button
                key={athlete.id}
                type="button"
                onClick={() => router.push(`/app/transfer/${athlete.id}`)}
                className="w-full bg-surface border border-border rounded-lg p-4 mb-3 flex items-center gap-3 hover:border-violet-300 transition"
              >
                {inner}
              </button>
            );
          })
        )}
      </main>
    </div>
  );
}
