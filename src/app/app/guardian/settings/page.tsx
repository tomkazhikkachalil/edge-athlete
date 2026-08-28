'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import dynamic from 'next/dynamic';
import RadioCard from '@/components/guardian/RadioCard';
import ConfirmModal from '@/components/ConfirmModal';

const BlockedUsersList = dynamic(() => import('@/components/settings/BlockedUsersList'), { ssr: false });
import { useToast } from '@/components/Toast';
import { formatDisplayName } from '@/lib/formatters';
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

/** Human label for a stored value, for the safety feed. */
function valueLabel(field: string, value: string | null): string {
  if (value === null) return '—';
  const options = FIELD_OPTIONS[field as SafetyField];
  return options?.find(o => o.value === value)?.label ?? value;
}

interface RosterAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  handle: string | null;
  supervision_state: string | null;
  deletion_requested_at: string | null;
  deviations?: string[];
}

interface AuditEvent {
  id: string;
  createdAt: string;
  field: string;
  oldValue: string | null;
  newValue: string;
  athlete: { id: string; name: string; handle: string | null };
  actor: { id: string; name: string } | null;
}

export default function HouseholdSettingsPage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<'loading' | 'ready' | 'forbidden' | 'load_error'>('loading');
  const [policy, setPolicy] = useState<HouseholdPolicy | null>(null);
  const [saving, setSaving] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [athletes, setAthletes] = useState<RosterAthlete[]>([]);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [confirmingApply, setConfirmingApply] = useState(false);
  const [applying, setApplying] = useState(false);

  // Informational sections — never break the page (athlete-page doctrine).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const [rosterRes, auditRes] = await Promise.all([
          fetch('/api/guardian/athletes'),
          fetch('/api/guardian/audit'),
        ]);
        if (cancelled) return;
        if (rosterRes.ok) {
          const data = await rosterRes.json().catch(() => ({}));
          setAthletes(
            (data.athletes ?? []).filter(
              (a: RosterAthlete) => a.supervision_state === 'supervised' && !a.deletion_requested_at
            )
          );
        }
        if (auditRes.ok) {
          const data = await auditRes.json().catch(() => ({}));
          setEvents(data.events ?? []);
        }
      } catch {
        // informational only
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, retryKey, saving, applying]);

  const applyToAll = async () => {
    setApplying(true);
    try {
      const res = await fetch('/api/guardian/household/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not apply household defaults');
      const results: Array<{ ok: boolean; changed?: string[]; skipped?: string[] }> = data.results ?? [];
      const changedCount = results.filter(r => r.ok && (r.changed?.length ?? 0) > 0).length;
      const skippedVisibility = results.some(r => r.ok && r.skipped?.includes('visibility'));
      showSuccess(
        changedCount > 0 ? `Updated ${changedCount} athlete${changedCount === 1 ? '' : 's'}` : 'Already matching',
        skippedVisibility
          ? 'Athletes without a completed consent review stay private.'
          : 'Every change is recorded in the safety log.'
      );
      setConfirmingApply(false);
    } catch (e) {
      showError('Could not apply', e instanceof Error ? e.message : undefined);
    } finally {
      setApplying(false);
    }
  };

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

            {/* Apply-to-all (Wave 4 PR B): loops the per-athlete PATCH
                semantics server-side — consent-pending athletes stay
                private, every change lands in the safety log below. */}
            {athletes.length > 0 && (
              <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                <h2 className="text-base font-bold text-primary mb-1">Apply to your athletes</h2>
                <p className="text-xs text-tertiary mb-3">
                  {(() => {
                    const differing = athletes.filter(a => (a.deviations?.length ?? 0) > 0).length;
                    return differing > 0
                      ? `${differing} of ${athletes.length} athlete${athletes.length === 1 ? '' : 's'} differ${differing === 1 ? 's' : ''} from these defaults.`
                      : `All ${athletes.length} athlete${athletes.length === 1 ? '' : 's'} match your defaults.`;
                  })()}
                </p>
                <button
                  type="button"
                  disabled={applying || policy === null}
                  onClick={() => setConfirmingApply(true)}
                  className="px-4 py-2 min-h-[44px] inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  <i className="fas fa-wand-magic-sparkles text-xs"></i>
                  Apply to all athletes
                </button>
                {policy === null && (
                  <p className="text-xs text-muted mt-2">Adopt a default above first.</p>
                )}
              </section>
            )}

            {/* Recent safety changes — the household's accountability mirror
                (the first reader of the append-only safety audit). */}
            <section className="bg-surface border border-border rounded-lg p-5 mb-4">
              <h2 className="text-base font-bold text-primary mb-1">Recent safety changes</h2>
              <p className="text-xs text-tertiary mb-4">
                Every change to your athletes&apos; safety settings — who changed
                what, and what it was before.
              </p>
              {events.length === 0 ? (
                <p className="text-sm text-muted">No safety changes recorded yet.</p>
              ) : (
                (() => {
                  const grouped = new Map<string, AuditEvent[]>();
                  for (const event of events) {
                    const day = new Date(event.createdAt).toLocaleDateString(undefined, {
                      weekday: 'long', month: 'long', day: 'numeric',
                    });
                    grouped.set(day, [...(grouped.get(day) ?? []), event]);
                  }
                  return [...grouped.entries()].map(([day, dayEvents]) => (
                    <div key={day} className="mb-4 last:mb-0">
                      <h3 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{day}</h3>
                      <ul className="divide-y divide-border">
                        {dayEvents.map(event => (
                          <li key={event.id} className="py-2 text-sm">
                            <span className="text-primary font-medium">
                              {event.actor?.name ?? 'A guardian'}
                            </span>{' '}
                            <span className="text-secondary">
                              changed {event.athlete.name}&apos;s {FIELD_TITLES[event.field as SafetyField]?.toLowerCase() ?? event.field}
                            </span>
                            {/* Old → new on its OWN line (375px chip rule). */}
                            <span className="block text-xs text-muted mt-0.5">
                              {valueLabel(event.field, event.oldValue)} → {valueLabel(event.field, event.newValue)}
                              {' · '}
                              {new Date(event.createdAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ));
                })()
              )}
            </section>

            {/* Household block list (Wave 4 PR C): one action blocks a person
                for you AND every athlete you manage. */}
            <section className="bg-surface border border-border rounded-lg p-5 mb-4">
              <h2 className="text-base font-bold text-primary mb-1">Household block list</h2>
              <p className="text-xs text-tertiary mb-4">
                Blocking here covers your whole household — you and every
                athlete you manage. Per-athlete blocks stay on each
                athlete&apos;s page.
              </p>
              <BlockedUsersList scope="household" canAdd subjectName="your household" />
            </section>
          </>
        )}
      </main>

      <ConfirmModal
        isOpen={confirmingApply}
        title="Apply household defaults to all athletes?"
        message={`This will update safety settings for ${athletes
          .map(a => formatDisplayName(a.first_name, null, a.last_name, a.display_name))
          .join(', ')} to match your household defaults. Athletes without a completed consent review stay private. Every change is recorded in the safety log.`}
        confirmText={applying ? 'Applying…' : 'Apply to all'}
        confirmButtonClass="bg-brand hover:bg-brand-hover"
        cancelText="Cancel"
        onConfirm={() => void applyToAll()}
        onCancel={() => setConfirmingApply(false)}
      />
    </div>
  );
}
