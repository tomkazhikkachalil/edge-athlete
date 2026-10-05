'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { formsFromProfile, recruitingAcademics, type RecruitingForm } from '@/lib/profiles/edit-forms';
import { parseRecruitingStatus, type RecruitingProfile, type RecruitingStatus } from '@/lib/recruiting/profile';
import { shortlistedByLabel } from '@/lib/recruiting/shortlist';
import RecruitingFields from '@/components/recruiting/RecruitingFields';
import SupervisedSettingCard from './SupervisedSettingCard';

// ── Settings → Recruiting (Oct 4 2026) ────────────────────────────────────
// Tom: "the recruiting shouldn't be displayed on the user profile … moved
// over to settings." The profile shows NOTHING recruiting-related — not to
// the owner, not to a visitor, not to a scout — until the scout program
// gives it a surface again (the card lived in
// src/components/recruiting/RecruitingCard.tsx; git has it). This section is
// the athlete's one door: the status (the ONE gate, convention 14), the
// school and the academics, saved through the gated PATCH, plus the count of
// scouts who shortlisted them — never who. A supervised athlete reads a
// guardian-managed card: recruiting is the guardian's decision.

interface Read {
  supported: boolean;
  status: RecruitingStatus;
  canEdit: boolean;
  school?: string | null;
  profile?: RecruitingProfile;
  shortlistedBy?: number;
}

export default function RecruitingSettings() {
  const { user, profile } = useAuth();
  const { showSuccess, showError } = useToast();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [form, setForm] = useState<RecruitingForm>(() => formsFromProfile(null).recruiting);
  const [shortlistedBy, setShortlistedBy] = useState(0);
  const [saving, setSaving] = useState(false);

  const supervised = profile?.supervision_state === 'supervised';

  useEffect(() => {
    if (!user?.id || supervised) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${user.id}/recruiting`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Read;
        if (cancelled) return;
        setSupported(data.supported);
        setForm({
          status: parseRecruitingStatus(data.status),
          school: data.school ?? '',
          ...recruitingAcademics(data.profile),
        });
        setShortlistedBy(data.shortlistedBy ?? 0);
      } catch {
        /* informational — the form keeps its empty defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, supervised]);

  const save = async () => {
    if (!user?.id) return;
    const gpaRaw = form.gpa.trim();
    const gpa = gpaRaw === '' ? null : Number(gpaRaw);
    if (gpa !== null && (!Number.isFinite(gpa) || gpa < 0 || gpa > 5)) {
      showError('Check the GPA', 'GPA must be between 0 and 5.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/profile/${user.id}/recruiting`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: form.status,
          school: form.school.trim(),
          profile: {
            gpa,
            academic_notes: form.academic_notes.trim() || null,
            target_level: form.target_level || null,
          },
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save recruiting details');
      }
      showSuccess('Recruiting saved', 'Your recruiting details are up to date.');
    } catch (e) {
      showError('Could not save', e instanceof Error ? e.message : 'Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6" data-recruiting-settings="">
      <div>
        <h2 className="text-xl font-semibold text-primary">Recruiting</h2>
        <p className="text-sm text-tertiary mt-1">
          Nothing recruiting-related shows on your profile. When recruiting is open, coaches and scouts find you through Scout search; contact stays through messages.
        </p>
      </div>

      {supervised ? (
        <SupervisedSettingCard
          icon="fa-graduation-cap"
          iconColor="text-brand-fg"
          label="Recruiting"
          description="A guardian decides whether you are recruiting."
        />
      ) : supported === false ? (
        <p className="text-sm text-tertiary" data-recruiting-unsupported="">
          Recruiting needs a database migration (182) before it can be opened.
        </p>
      ) : (
        <>
          {shortlistedByLabel(shortlistedBy) && (
            <p className="text-sm text-secondary" data-shortlisted-by={shortlistedBy}>{shortlistedByLabel(shortlistedBy)}</p>
          )}
          <RecruitingFields value={form} onChange={setForm} disabled={supported === null} />
          <div className="flex justify-end">
            <button
              type="button"
              onClick={save}
              disabled={saving || supported === null}
              className="ea-cta px-5 py-2.5 rounded-lg text-sm font-semibold text-white disabled:opacity-60 min-h-[44px]"
            >
              {saving ? 'Saving…' : 'Save recruiting'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
