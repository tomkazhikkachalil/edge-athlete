'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import AppHeader from '@/components/AppHeader';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials, formatAge } from '@/lib/formatters';
import { transferStateChip } from '@/lib/transfer-ui';
import {
  consentChip,
  loginChip,
  type Chip,
} from '@/lib/guardian-rollup';
import {
  VISIBILITY_OPTIONS,
  MESSAGING_OPTIONS,
  type Visibility,
  type MessagingPermission,
} from '@/lib/profile-privacy';
import type { ConsentState } from '@/lib/consent';

// ── Per-athlete management ────────────────────────────────────────────────────
// One athlete's custody view: identity, live safety controls (the PATCH this
// page drives is the only way a guardian changes these after creation), and
// the doors into consent, login credentials, and transfer — pages that used
// to be reachable only from the creation funnel.

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

function ChipPill({ chip }: { chip: Chip }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${CHIP_TONES[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

function RadioCard<V extends string>({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: { value: V; label: string; description: string };
  selected: boolean;
  disabled: boolean;
  onSelect: (value: V) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.value)}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all disabled:opacity-60 ${
        selected ? 'border-brand bg-brand-soft' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            selected ? 'border-brand bg-brand' : 'border-border-strong'
          }`}
        >
          {selected && <i className="fas fa-check text-white text-xs"></i>}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-primary text-sm mb-0.5">{option.label}</h4>
          <p className="text-xs text-tertiary">{option.description}</p>
        </div>
      </div>
    </button>
  );
}

export default function GuardianAthletePage() {
  const params = useParams();
  const router = useRouter();
  const profileId = params.profileId as string;
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [athlete, setAthlete] = useState<ConsoleAthlete | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user || !profileId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const found = (data.athletes ?? []).find((a: ConsoleAthlete) => a.id === profileId) ?? null;
        setAthlete(found);
      } catch {
        if (!cancelled) setAthlete(null);
      } finally {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profileId]);

  // Optimistic safety change with revert — the 403 consent-gate message from
  // the server is surfaced verbatim so the guardian learns the WHY.
  const applySafety = async (patch: { visibility?: Visibility; messaging_permission?: MessagingPermission }) => {
    if (!athlete || saving) return;
    const before = athlete;
    setAthlete({ ...athlete, ...patch });
    setSaving(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${athlete.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the change');
      showSuccess('Saved', 'Safety settings updated.');
    } catch (e) {
      setAthlete(before);
      showError('Not saved', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const name = athlete
    ? formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.display_name)
    : '';
  const transferred = athlete?.supervision_state === 'self';

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/app/guardian"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : !athlete ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <h1 className="text-h3 font-bold text-primary mb-2">Not one of your athletes</h1>
            <p className="text-sm text-tertiary mb-4">
              This profile isn&apos;t managed by your account.
            </p>
            <Link
              href="/app/guardian"
              className="inline-flex items-center px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover"
            >
              Back to the console
            </Link>
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="flex items-center gap-4 mb-6">
              <div className="relative w-16 h-16 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                {athlete.avatar_url ? (
                  <Image
                    src={athlete.avatar_url}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized={!isOptimizableImageSrc(athlete.avatar_url)}
                  />
                ) : (
                  <span className="text-lg font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                )}
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold text-primary truncate">{name}</h1>
                <p className="text-sm text-muted truncate">
                  {athlete.handle && <>@{athlete.handle} · </>}
                  {athlete.dob && <>{formatAge(athlete.dob)} · </>}
                  {transferred ? 'Transferred' : 'Supervised'}
                </p>
              </div>
            </div>

            {transferred ? (
              <div className="bg-surface border border-border rounded-lg p-6 text-sm text-tertiary">
                This account has been handed over to its owner. They control
                their own settings now.
              </div>
            ) : (
              <>
                {/* Safety */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Safety</h2>
                  <p className="text-xs text-tertiary mb-4">
                    How the outside world can reach {athlete.first_name || 'this athlete'}.
                    Changes apply immediately.
                  </p>
                  <h3 className="text-sm font-semibold text-secondary mb-2">Profile visibility</h3>
                  <div className="space-y-2 mb-5">
                    {VISIBILITY_OPTIONS.map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={athlete.visibility === option.value}
                        disabled={saving}
                        onSelect={v => applySafety({ visibility: v })}
                      />
                    ))}
                  </div>
                  <h3 className="text-sm font-semibold text-secondary mb-2">Who can send messages</h3>
                  <div className="space-y-2">
                    {MESSAGING_OPTIONS.map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={athlete.messaging_permission === option.value}
                        disabled={saving}
                        onSelect={v => applySafety({ messaging_permission: v })}
                      />
                    ))}
                  </div>
                </section>

                {/* Consent */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Consent</h2>
                    <ChipPill chip={consentChip(athlete.consentState)} />
                  </div>
                  <Link
                    href={`/app/guardian/consent/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.consentState === 'approved' ? 'View consent' : 'Complete consent'}
                  </Link>
                </section>

                {/* Login */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Login</h2>
                    <ChipPill chip={loginChip(athlete.hasLogin)} />
                  </div>
                  <Link
                    href={`/app/guardian/credentials/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.hasLogin ? 'Manage login' : 'Issue login'}
                  </Link>
                </section>

                {/* Transfer */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Account transfer</h2>
                    <ChipPill
                      chip={
                        athlete.activeTransfer
                          ? transferStateChip(athlete.activeTransfer.state as Parameters<typeof transferStateChip>[0])
                          : { label: 'Supervised', tone: 'gray' }
                      }
                    />
                  </div>
                  <Link
                    href={`/app/transfer/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.activeTransfer ? 'View transfer' : 'Hand over the account'}
                  </Link>
                </section>

                {/* Danger zone */}
                <section className="border border-red-200 dark:border-red-900 rounded-lg p-5">
                  <h2 className="text-base font-bold text-red-600 dark:text-red-400 mb-1">Danger zone</h2>
                  <p className="text-xs text-tertiary mb-3">
                    Withdrawing consent permanently deletes this profile and all
                    of its content.
                  </p>
                  <Link
                    href={`/app/guardian/credentials/${athlete.id}`}
                    className="inline-flex items-center px-3 py-2 min-h-[44px] border border-red-300 dark:border-red-800 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    Withdraw consent &amp; delete
                  </Link>
                </section>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
