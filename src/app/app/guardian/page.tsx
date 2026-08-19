'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials, formatAge } from '@/lib/formatters';
import { transferStateChip } from '@/lib/transfer-ui';
import {
  consentChip,
  loginChip,
  visibilityChip,
  type Chip,
} from '@/lib/guardian-rollup';
import type { ConsentState } from '@/lib/consent';

// ── Family console ────────────────────────────────────────────────────────────
// The guardianship layer's home: every athlete this account is responsible
// for, what needs attention, and the way into each one. Three questions, in
// order: what happened? what needs me? what are they allowed to do?
//
// Chrome is AppHeader (not BrandBar): this is a recurring signed-in
// destination like /settings, not a step in a funnel — the linear guardian
// flows (add-athlete, consent, credentials, transfer) keep BrandBar.

interface ConsoleAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  dob: string | null;
  supervision_state: string | null;
  visibility: string | null;
  messaging_permission: string | null;
  consentState: ConsentState;
  hasLogin: boolean;
  pendingPostCount: number;
  activeTransfer: { state: string } | null;
}

const CHIP_TONES = {
  violet: 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong',
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  gray: 'bg-surface-sunken text-tertiary',
} as const;

/** Transfer states where the ball is in the guardian's court. */
const TRANSFER_NEEDS_GUARDIAN = new Set(['requested', 'dual_confirm']);

interface AttentionItem {
  key: string;
  label: string;
  href: string;
}

function buildAttentionItems(athletes: ConsoleAthlete[]): AttentionItem[] {
  const items: AttentionItem[] = [];
  const totalPending = athletes.reduce((n, a) => n + a.pendingPostCount, 0);
  if (totalPending > 0) {
    items.push({
      key: 'pending',
      label: `${totalPending} post${totalPending === 1 ? '' : 's'} waiting for your review`,
      href: '/app/guardian/approvals',
    });
  }
  for (const a of athletes) {
    const name = formatDisplayName(a.first_name, null, a.last_name, a.display_name);
    if (a.activeTransfer && TRANSFER_NEEDS_GUARDIAN.has(a.activeTransfer.state)) {
      items.push({
        key: `transfer-${a.id}`,
        label: `${name}'s account transfer needs you`,
        href: `/app/transfer/${a.id}`,
      });
    }
    if (a.supervision_state === 'supervised' && (a.consentState === 'none' || a.consentState === 'rejected')) {
      items.push({
        key: `consent-${a.id}`,
        label: `Finish consent for ${name}`,
        href: `/app/guardian/consent/${a.id}`,
      });
    }
    if (a.supervision_state === 'supervised' && !a.hasLogin) {
      items.push({
        key: `login-${a.id}`,
        label: `${name} has no login yet`,
        href: `/app/guardian/credentials/${a.id}`,
      });
    }
  }
  return items;
}

function ChipPill({ chip }: { chip: Chip }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${CHIP_TONES[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

export default function FamilyConsolePage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete, managedProfiles, activeProfile, setActiveProfile } = useAuth();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [athletes, setAthletes] = useState<ConsoleAthlete[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes');
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load your athletes');
        if (cancelled) return;
        setAthletes(data.athletes ?? []);
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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const attention = buildAttentionItems(athletes);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h1 className="text-2xl font-bold text-primary">Family console</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/app/guardian/add-athlete"
              className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <i className="fas fa-plus text-xs"></i>
              Add athlete
            </Link>
            <Link
              href="/app/guardian/approvals"
              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
            >
              Approvals
            </Link>
            <Link
              href="/app/guardian/transfers"
              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
            >
              Transfers
            </Link>
          </div>
        </div>
        <p className="text-sm text-tertiary mb-6">
          The athletes you&apos;re responsible for — what&apos;s happening, what needs you,
          and what each profile is allowed to do.
        </p>

        {error && (
          <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-4">
            {error}
          </div>
        )}

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : (
          <>
            {attention.length > 0 && (
              <section aria-label="Needs your attention" className="mb-6">
                <h2 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">
                  Needs you
                </h2>
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-lg divide-y divide-amber-200 dark:divide-amber-900">
                  {attention.map(item => (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex items-center justify-between gap-3 px-4 py-3 min-h-[44px] text-sm font-medium text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-950/60 transition-colors first:rounded-t-lg last:rounded-b-lg"
                    >
                      <span>{item.label}</span>
                      <i className="fas fa-chevron-right text-xs text-amber-400 shrink-0"></i>
                    </Link>
                  ))}
                </div>
              </section>
            )}

            {athletes.length === 0 ? (
              <div className="bg-surface border border-border rounded-lg p-8 text-center">
                <p className="text-sm text-muted mb-4">
                  You&apos;re not managing any athlete profiles yet.
                </p>
                <Link
                  href="/app/guardian/add-athlete"
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  <i className="fas fa-plus text-xs"></i>
                  Add your first athlete
                </Link>
              </div>
            ) : (
              athletes.map(a => {
                const name = formatDisplayName(a.first_name, null, a.last_name, a.display_name);
                const transferred = a.supervision_state === 'self';
                const isActive = activeProfile?.id === a.id;
                const managed = managedProfiles.find(mp => mp.id === a.id) ?? null;
                return (
                  <div key={a.id} className="bg-surface border border-border rounded-lg p-4 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                        {a.avatar_url ? (
                          <Image
                            src={a.avatar_url}
                            alt=""
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized={!isOptimizableImageSrc(a.avatar_url)}
                          />
                        ) : (
                          <span className="text-sm font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                        )}
                      </div>
                      <div className="flex-grow min-w-0">
                        <p className="text-sm font-semibold text-primary truncate">
                          {name}
                          {a.dob && <span className="font-normal text-muted"> · {formatAge(a.dob)}</span>}
                        </p>
                        {a.handle && <p className="text-xs text-muted truncate">@{a.handle}</p>}
                      </div>
                      {a.pendingPostCount > 0 && (
                        <Link
                          href="/app/guardian/approvals"
                          className="shrink-0 min-w-[24px] h-6 px-2 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold"
                          aria-label={`${a.pendingPostCount} posts pending review`}
                        >
                          {a.pendingPostCount}
                        </Link>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      {transferred ? (
                        <ChipPill chip={{ label: 'Transferred', tone: 'gray' }} />
                      ) : (
                        <>
                          <ChipPill chip={consentChip(a.consentState)} />
                          <ChipPill chip={loginChip(a.hasLogin)} />
                          <ChipPill chip={visibilityChip(a.visibility)} />
                          {a.activeTransfer && (
                            <ChipPill chip={transferStateChip(a.activeTransfer.state as Parameters<typeof transferStateChip>[0])} />
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {!transferred && managed && (
                        <button
                          type="button"
                          onClick={() => setActiveProfile(isActive ? null : managed)}
                          className={`px-3 py-2 min-h-[44px] inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
                            isActive
                              ? 'bg-brand text-white hover:bg-brand-hover'
                              : 'border border-border-strong text-secondary hover:bg-surface-muted'
                          }`}
                        >
                          <i className={`fas ${isActive ? 'fa-circle-check' : 'fa-right-left'} text-xs`}></i>
                          {isActive ? 'Acting as — switch back' : 'Switch into'}
                        </button>
                      )}
                      <Link
                        href={`/athlete/${a.id}`}
                        className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                      >
                        View profile
                      </Link>
                      {!transferred && (
                        <Link
                          href={`/app/guardian/athlete/${a.id}`}
                          className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 border border-violet-300 dark:border-violet-800 rounded-lg text-sm font-semibold text-brand-fg-strong hover:bg-brand-soft transition-colors"
                        >
                          <i className="fas fa-sliders text-xs"></i>
                          Manage
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </main>
    </div>
  );
}
