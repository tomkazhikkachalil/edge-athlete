'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import {
  clearRegistrationDraft,
  isEmptyRegistrationDraft,
  loadRegistrationDraft,
  saveRegistrationDraft,
  type RegistrationDraft,
} from '@/lib/registration/wizard-draft';

// ── The family registration wizard (phase 5 R3) ─────────────────────────────
// The OrgStartWizard machine: a named-union Step, all state hoisted here,
// sibling step blocks, transitions in per-step handlers, a debounced
// localStorage draft offered back as a notice (never silently applied).
// Server-enforced branching is the contract — everything here is
// convenience; the POST re-runs every gate (window, supervised,
// collisions) unconditionally.
//
// WHO can be registered: the signed-in adult ("Myself" — hidden for
// supervised viewers: a guardian registers them), or a child the viewer
// GUARDIANS (viewer-only seats are read-only and excluded). The submit
// carries profileId only when acting for a child — the route vouches it
// with requireProfileRole.

type Step = 'who' | 'offering' | 'details' | 'consents' | 'review' | 'done';

interface ChildRow {
  id: string;
  display_name?: string | null;
  first_name?: string | null;
  dob?: string | null;
}

interface OfferingSeason {
  id: string;
  label: string;
  startsOn: string | null;
  divisions: { id: string; name: string; ageBand: string | null; genderStream: string | null; tier: string | null; open: boolean }[];
  programs: { id: string; name: string; type: string; open: boolean }[];
}

interface SubmitResult {
  status: string;
  warnings: { kind: string; message: string }[];
  photoConsentRecorded: boolean;
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'who', label: 'Who' },
  { key: 'offering', label: 'Program' },
  { key: 'details', label: 'Details' },
  { key: 'consents', label: 'Consent' },
  { key: 'review', label: 'Review' },
];

export default function RegistrationWizard({
  side,
  orgId,
  orgName,
}: {
  side: 'league' | 'club';
  orgId: string;
  orgName: string;
}) {
  const { user, profile } = useAuth();
  const { showError } = useToast();
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const [step, setStep] = useState<Step>('who');
  const [children, setChildren] = useState<ChildRow[]>([]);
  const [childrenReadOnly, setChildrenReadOnly] = useState(false);
  const [seasons, setSeasons] = useState<OfferingSeason[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [draftNotice, setDraftNotice] = useState<RegistrationDraft | null>(null);

  // Form state (flat — the draft's exact shape).
  const [targetProfileId, setTargetProfileId] = useState('');
  const [seasonId, setSeasonId] = useState('');
  const [divisionId, setDivisionId] = useState('');
  const [programId, setProgramId] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [medicalNotes, setMedicalNotes] = useState('');
  const [photoConsent, setPhotoConsent] = useState(false);
  const [birthday, setBirthday] = useState('');

  const viewerSupervised = profile?.supervision_state === 'supervised';
  const selfOption = !viewerSupervised;

  // Load children + offerings once; offer a stored draft as a notice.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [childrenRes, offeringsRes] = await Promise.all([
          fetch('/api/guardian/athletes', { credentials: 'include' }),
          fetch(`/api/${plural}/${orgId}/offerings`, { credentials: 'include' }),
        ]);
        if (cancelled) return;
        if (childrenRes.ok) {
          const body = await childrenRes.json();
          if (!cancelled) {
            setChildren((body.athletes ?? []) as ChildRow[]);
            setChildrenReadOnly(body.readOnly === true);
          }
        }
        if (offeringsRes.ok) {
          const body = await offeringsRes.json();
          if (!cancelled) setSeasons((body.seasons ?? []) as OfferingSeason[]);
        }
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    // The RegistrationSteps rehydrate recipe: never a synchronous setState
    // in the effect body (hydration mismatch + cascading-render lint).
    const draftTimerId = setTimeout(() => {
      const draft = loadRegistrationDraft(side, orgId);
      if (draft && !isEmptyRegistrationDraft(draft)) setDraftNotice(draft);
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(draftTimerId);
    };
  }, [user?.id, plural, side, orgId]);

  // Debounced autosave (the composer-draft recipe).
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || result) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const draft: RegistrationDraft = {
      step,
      targetProfileId,
      seasonId,
      divisionId,
      programId,
      emergencyName,
      emergencyPhone,
      medicalNotes,
      photoConsent,
      birthday,
    };
    draftTimer.current = setTimeout(() => {
      if (!isEmptyRegistrationDraft(draft)) saveRegistrationDraft(side, orgId, draft);
    }, 400);
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [loaded, result, step, targetProfileId, seasonId, divisionId, programId, emergencyName, emergencyPhone, medicalNotes, photoConsent, birthday, side, orgId]);

  const restoreDraft = () => {
    const d = draftNotice;
    if (!d) return;
    setTargetProfileId(d.targetProfileId);
    setSeasonId(d.seasonId);
    setDivisionId(d.divisionId);
    setProgramId(d.programId);
    setEmergencyName(d.emergencyName);
    setEmergencyPhone(d.emergencyPhone);
    setMedicalNotes(d.medicalNotes);
    setPhotoConsent(d.photoConsent);
    setBirthday(d.birthday);
    setStep((STEPS.some(s => s.key === d.step) ? d.step : 'who') as Step);
    setDraftNotice(null);
  };

  const targetIsSelf = targetProfileId === user?.id;
  const targetChild = children.find(c => c.id === targetProfileId) ?? null;
  const targetBirthdayKnown = targetIsSelf
    ? !!(profile as { birthday?: string | null } | null)?.birthday
    : !!targetChild?.dob;
  const season = seasons.find(s => s.id === seasonId) ?? null;
  const chosenDivision = season?.divisions.find(d => d.id === divisionId) ?? null;
  const chosenProgram = season?.programs.find(p => p.id === programId) ?? null;
  const anyOpen = useMemo(
    () => seasons.some(s => s.divisions.some(d => d.open) || s.programs.some(p => p.open)),
    [seasons]
  );

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/registrations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          seasonId,
          ...(divisionId ? { divisionId } : {}),
          ...(programId ? { programId } : {}),
          ...(targetIsSelf ? {} : { profileId: targetProfileId }),
          answers: {
            ...(emergencyName.trim()
              ? { emergencyContact: { name: emergencyName.trim(), phone: emergencyPhone.trim() } }
              : {}),
            ...(medicalNotes.trim() ? { medicalNotes: medicalNotes.trim() } : {}),
          },
          photoConsent,
          ...(birthday && !targetBirthdayKnown ? { birthday } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Registration', body.error || 'Failed to register');
        return;
      }
      clearRegistrationDraft(side, orgId);
      setResult(body as SubmitResult);
      setStep('done');
    } catch {
      showError('Registration', 'Failed to register');
    } finally {
      setSubmitting(false);
    }
  };

  if (!loaded) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  const targetName = targetIsSelf
    ? 'Myself'
    : (targetChild?.display_name || targetChild?.first_name || 'Athlete');
  const input =
    'w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm';
  const primaryBtn =
    'px-4 py-2 text-sm min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50';
  const backBtn =
    'px-4 py-2 text-sm min-h-[44px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors';

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {step !== 'done' && (
        <ol className="flex flex-wrap gap-2" aria-label="Registration steps">
          {STEPS.map((s, i) => (
            <li
              key={s.key}
              className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                s.key === step
                  ? 'bg-brand text-white'
                  : STEPS.findIndex(x => x.key === step) > i
                    ? 'bg-brand-soft text-brand-fg'
                    : 'bg-surface-sunken text-muted'
              }`}
            >
              {i + 1}. {s.label}
            </li>
          ))}
        </ol>
      )}

      {draftNotice && step !== 'done' && (
        <div className="bg-surface border border-border rounded-lg p-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-secondary">You have an unfinished registration here.</span>
          <button type="button" onClick={restoreDraft} className="text-brand-fg font-medium">
            Continue it
          </button>
          <button
            type="button"
            onClick={() => {
              clearRegistrationDraft(side, orgId);
              setDraftNotice(null);
            }}
            className="text-muted"
          >
            Start over
          </button>
        </div>
      )}

      {step === 'who' && (
        <section className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">Who is registering?</h2>
          {viewerSupervised && (
            <p className="text-sm text-tertiary">
              Your guardian registers you for organizations — ask them to sign in and register you here.
            </p>
          )}
          <div className="space-y-2" role="radiogroup" aria-label="Athlete">
            {selfOption && (
              <label className="flex items-center gap-2 text-sm text-secondary">
                <input
                  type="radio"
                  name="who"
                  checked={targetIsSelf}
                  onChange={() => setTargetProfileId(user?.id ?? '')}
                />
                Myself
              </label>
            )}
            {!childrenReadOnly &&
              children.map(child => (
                <label key={child.id} className="flex items-center gap-2 text-sm text-secondary">
                  <input
                    type="radio"
                    name="who"
                    checked={targetProfileId === child.id}
                    onChange={() => setTargetProfileId(child.id)}
                  />
                  {child.display_name || child.first_name || 'Athlete'}
                </label>
              ))}
          </div>
          {!selfOption && children.length === 0 && !viewerSupervised && (
            <p className="text-sm text-tertiary">No athletes to register.</p>
          )}
          <button
            type="button"
            disabled={!targetProfileId}
            onClick={() => setStep('offering')}
            className={primaryBtn}
          >
            Next
          </button>
        </section>
      )}

      {step === 'offering' && (
        <section className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">Pick a program</h2>
          {!anyOpen && (
            <p className="text-sm text-tertiary">Registration is currently closed.</p>
          )}
          {seasons.map(s => (
            <div key={s.id} className="space-y-1">
              <p className="text-sm font-semibold text-secondary">{s.label}</p>
              <div className="space-y-1.5" role="radiogroup" aria-label={`Offerings in ${s.label}`}>
                {s.divisions.map(d => (
                  <label
                    key={d.id}
                    className={`flex items-center gap-2 text-sm ${d.open ? 'text-secondary' : 'text-faint'}`}
                  >
                    <input
                      type="radio"
                      name="offering"
                      disabled={!d.open}
                      checked={divisionId === d.id}
                      onChange={() => {
                        setSeasonId(s.id);
                        setDivisionId(d.id);
                        setProgramId('');
                      }}
                    />
                    <span>
                      {d.name}
                      <span className="text-muted">
                        {[d.ageBand, d.genderStream, d.tier].filter(Boolean).length > 0
                          ? ` · ${[d.ageBand, d.genderStream, d.tier].filter(Boolean).join(' · ')}`
                          : ''}
                        {d.open ? '' : ' · closed'}
                      </span>
                    </span>
                  </label>
                ))}
                {s.programs.map(p => (
                  <label
                    key={p.id}
                    className={`flex items-center gap-2 text-sm ${p.open ? 'text-secondary' : 'text-faint'}`}
                  >
                    <input
                      type="radio"
                      name="offering"
                      disabled={!p.open}
                      checked={programId === p.id}
                      onChange={() => {
                        setSeasonId(s.id);
                        setProgramId(p.id);
                        setDivisionId('');
                      }}
                    />
                    <span>
                      {p.name}
                      <span className="text-muted"> · {p.type}{p.open ? '' : ' · closed'}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('who')} className={backBtn}>
              Back
            </button>
            <button
              type="button"
              disabled={!seasonId || (!divisionId && !programId)}
              onClick={() => setStep('details')}
              className={primaryBtn}
            >
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'details' && (
        <section className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">Details</h2>
          <label className="block text-sm text-secondary">
            Emergency contact name
            <input
              type="text"
              value={emergencyName}
              maxLength={80}
              onChange={e => setEmergencyName(e.target.value)}
              className={`mt-1 ${input}`}
            />
          </label>
          <label className="block text-sm text-secondary">
            Emergency contact phone
            <input
              type="tel"
              value={emergencyPhone}
              maxLength={40}
              onChange={e => setEmergencyPhone(e.target.value)}
              className={`mt-1 ${input}`}
            />
          </label>
          <label className="block text-sm text-secondary">
            Medical notes (allergies, conditions)
            <textarea
              value={medicalNotes}
              maxLength={1000}
              rows={3}
              onChange={e => setMedicalNotes(e.target.value)}
              className={`mt-1 ${input}`}
            />
            <span className="block mt-1 text-xs text-muted">
              Visible to the organization&apos;s registrar only.
            </span>
          </label>
          {!targetBirthdayKnown && (
            <label className="block text-sm text-secondary">
              Date of birth (for age-group checks)
              <input
                type="date"
                value={birthday}
                onChange={e => setBirthday(e.target.value)}
                className={`mt-1 ${input}`}
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('offering')} className={backBtn}>
              Back
            </button>
            <button type="button" onClick={() => setStep('consents')} className={primaryBtn}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'consents' && (
        <section className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">Photo consent</h2>
          <label className="flex items-start gap-2 text-sm text-secondary">
            <input
              type="checkbox"
              checked={photoConsent}
              onChange={e => setPhotoConsent(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Allow {orgName} to publish photos {targetIsSelf ? 'I’m' : `${targetName} is`} tagged
              in on its public site. You can change this anytime.
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('details')} className={backBtn}>
              Back
            </button>
            <button type="button" onClick={() => setStep('review')} className={primaryBtn}>
              Next
            </button>
          </div>
        </section>
      )}

      {step === 'review' && (
        <section className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">Review</h2>
          <dl className="text-sm space-y-1.5">
            <div className="flex gap-2">
              <dt className="text-muted w-32 shrink-0">Athlete</dt>
              <dd className="text-secondary min-w-0 truncate">{targetName}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted w-32 shrink-0">Season</dt>
              <dd className="text-secondary">{season?.label ?? '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted w-32 shrink-0">Offering</dt>
              <dd className="text-secondary min-w-0 truncate">
                {chosenDivision?.name ?? chosenProgram?.name ?? '—'}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted w-32 shrink-0">Photo consent</dt>
              <dd className="text-secondary">{photoConsent ? 'Allowed' : 'Not allowed'}</dd>
            </div>
          </dl>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setStep('consents')} className={backBtn}>
              Back
            </button>
            <button type="button" disabled={submitting} onClick={() => void submit()} className={primaryBtn}>
              {submitting ? 'Registering…' : 'Register'}
            </button>
          </div>
        </section>
      )}

      {step === 'done' && result && (
        <section className="bg-surface rounded-xl shadow-sm border border-brand p-4 sm:p-6 space-y-3">
          <h2 className="text-lg font-semibold text-primary">
            {targetName === 'Myself' ? 'You’re registered' : `${targetName} is registered`}
          </h2>
          <p className="text-sm text-secondary">
            {orgName} has the registration — you&apos;ll hear when a placement is made.
          </p>
          {result.warnings.length > 0 && (
            <ul className="text-sm text-secondary space-y-1">
              {result.warnings.map((w, i) => (
                <li key={i} className="flex gap-2">
                  <i className="fas fa-circle-info mt-0.5 text-brand-fg" aria-hidden="true"></i>
                  <span>{w.message} — the registrar will sort this out at placement.</span>
                </li>
              ))}
            </ul>
          )}
          <Link
            href={`/${side}/${orgId}`}
            className="inline-flex text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
          >
            Back to {orgName} →
          </Link>
        </section>
      )}
    </div>
  );
}
