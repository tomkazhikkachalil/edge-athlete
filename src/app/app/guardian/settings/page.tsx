'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import RadioCard from '@/components/guardian/RadioCard';
import { useToast } from '@/components/Toast';
import { FEATURE_FLAGS } from '@/lib/features';
import {
  COMMENT_MODERATION_OPTIONS,
  MESSAGING_OPTIONS,
  VISIBILITY_OPTIONS,
  type PrivacyOption,
} from '@/lib/profile-privacy';
import {
  RESTRICTIVE_PRESETS,
  type HouseholdPolicy,
  type HouseholdPresets,
  type SafetyField,
} from '@/lib/household-policy';

// ── Household settings (Wave 4, mig 132) ─────────────────────────────────────
// The guardian's safety DEFAULTS for every athlete they manage: what a new
// athlete starts with, and (via later PRs) the apply-to-all affordance, the
// safety-change feed and the household block list. Per-guardian by design —
// co-guardians may differ; the audit feed makes any overwrite visible.
// Immediate-save per control (PrivacySettings precedent): each selection
// PATCHes the full policy, optimistic with rollback.

const FIELD_OPTIONS: Record<SafetyField, PrivacyOption<string>[]> = {
  visibility: VISIBILITY_OPTIONS as PrivacyOption<string>[],
  messaging_permission: MESSAGING_OPTIONS as PrivacyOption<string>[],
  comment_moderation: COMMENT_MODERATION_OPTIONS as PrivacyOption<string>[],
};

const FIELD_TITLES: Record<SafetyField, string> = {
  visibility: 'Profile visibility',
  messaging_permission: 'Who can send messages',
  comment_moderation: 'Comments they write',
};

export default function HouseholdSettingsPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'load_error'>('loading');
  const [policy, setPolicy] = useState<HouseholdPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/household');
        if (res.status === 403) { if (!cancelled) setState('forbidden'); return; }
        if (!res.ok) { if (!cancelled) setState('load_error'); return; }
        const data = await res.json();
        if (cancelled) return;
        setPolicy(data.policy ?? null);
        setState('ready');
      } catch {
        if (!cancelled) setState('load_error');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, retryKey]);

  const save = async (next: HouseholdPolicy) => {
    const previous = policy;
    setPolicy(next);
    setSaving(true);
    try {
      const res = await fetch('/api/guardian/household', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(next),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save household defaults');
      setPolicy(data.policy ?? next);
      showSuccess('Household defaults saved', 'New athletes start with these settings.');
    } catch (e) {
      setPolicy(previous);
      showError('Could not save', e instanceof Error ? e.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  // A guardian who never adopted a policy edits from the restrictive base.
  const effective: HouseholdPolicy = policy ?? { defaults: RESTRICTIVE_PRESETS, olderDefaults: null };

  const setDefault = (field: SafetyField, value: string) =>
    void save({
      ...effective,
      defaults: { ...effective.defaults, [field]: value } as HouseholdPresets,
    });

  const setOlder = (field: SafetyField, value: string | undefined) => {
    const older = { ...(effective.olderDefaults ?? {}) };
    if (value === undefined) delete older[field];
    else (older as Record<string, string>)[field] = value;
    void save({ ...effective, olderDefaults: Object.keys(older).length > 0 ? older : null });
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user || state === 'loading') {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <Link
          href="/app/guardian"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>
        <h1 className="text-2xl font-bold text-primary mb-1">Household</h1>
        <p className="text-sm text-tertiary mb-6">
          Your defaults for every athlete you manage. New athletes start with
          these; changes here never touch an existing athlete without your
          say-so.
        </p>

        {state === 'forbidden' && (
          <p className="text-sm text-tertiary bg-surface border border-border rounded-lg p-6 text-center">
            Household settings are for guardians managing athlete profiles.
          </p>
        )}
        {state === 'load_error' && (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <p role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">
              Couldn&apos;t load your household defaults.
            </p>
            <button
              type="button"
              onClick={() => { setState('loading'); setRetryKey(k => k + 1); }}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover transition"
            >
              <i className="fas fa-rotate-right text-xs"></i>
              Try again
            </button>
          </div>
        )}

        {state === 'ready' && (
          <>
            <section className="bg-surface border border-border rounded-lg p-5 mb-4">
              <h2 className="text-base font-bold text-primary mb-1">Household defaults</h2>
              <p className="text-xs text-tertiary mb-4">
                What a new athlete starts with the moment you add them.
              </p>
              {(Object.keys(FIELD_TITLES) as SafetyField[]).map(field => (
                <div key={field} className="mb-5 last:mb-0">
                  <h3 className="text-sm font-semibold text-secondary mb-2">{FIELD_TITLES[field]}</h3>
                  <div className="flex flex-col gap-2">
                    {FIELD_OPTIONS[field].map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={effective.defaults[field] === option.value}
                        disabled={saving}
                        onSelect={value => setDefault(field, value)}
                      />
                    ))}
                  </div>
                  {field === 'visibility' && effective.defaults.visibility === 'public' && (
                    <p className="text-xs text-muted mt-2">
                      New athletes still start private; going public requires a
                      completed consent review.
                    </p>
                  )}
                </div>
              ))}
            </section>

            <section className="bg-surface border border-border rounded-lg p-5 mb-4">
              <h2 className="text-base font-bold text-primary mb-1">When they&apos;re older</h2>
              <p className="text-xs text-tertiary mb-4">
                Optional looser settings for when an athlete reaches the age of
                digital consent in your region. When one of your athletes
                crosses that age, you get a prompt — nothing changes until you
                confirm it.
              </p>
              {effective.olderDefaults === null ? (
                <button
                  type="button"
                  disabled={saving}
                  onClick={() =>
                    void save({
                      ...effective,
                      olderDefaults: { messaging_permission: effective.defaults.messaging_permission },
                    })
                  }
                  className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 border border-violet-300 dark:border-violet-800 rounded-lg text-sm font-semibold text-brand-fg-strong hover:bg-brand-soft transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-plus text-xs"></i>
                  Set older-athlete defaults
                </button>
              ) : (
                <>
                  {(Object.keys(FIELD_TITLES) as SafetyField[]).map(field => {
                    const overridden = effective.olderDefaults?.[field] !== undefined;
                    return (
                      <div key={field} className="mb-5">
                        <h3 className="text-sm font-semibold text-secondary mb-2">{FIELD_TITLES[field]}</h3>
                        <div className="flex flex-col gap-2">
                          <RadioCard
                            option={{
                              value: '__same__',
                              label: 'Same as household default',
                              description: 'No change when they cross the age boundary.',
                            }}
                            selected={!overridden}
                            disabled={saving}
                            onSelect={() => setOlder(field, undefined)}
                          />
                          {FIELD_OPTIONS[field].map(option => (
                            <RadioCard
                              key={option.value}
                              option={option}
                              selected={overridden && effective.olderDefaults?.[field] === option.value}
                              disabled={saving}
                              onSelect={value => setOlder(field, value)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void save({ ...effective, olderDefaults: null })}
                    className="inline-flex min-h-[44px] items-center text-xs font-semibold text-red-600 dark:text-red-400 hover:underline disabled:opacity-50"
                  >
                    Remove older-athlete defaults
                  </button>
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
