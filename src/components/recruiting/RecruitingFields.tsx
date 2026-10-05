'use client';

import {
  ACADEMIC_NOTES_MAX,
  RECRUITING_STATUSES,
  RECRUITING_STATUS_LABEL,
  SCHOOL_MAX,
  TARGET_LEVELS,
  TARGET_LEVEL_LABEL,
  type TargetLevel,
} from '@/lib/recruiting/profile';
import type { RecruitingForm } from '@/lib/profiles/edit-forms';

// ── The recruiting form, once (Oct 4 2026) ────────────────────────────────
// Two hosts render these fields: Settings → Recruiting (the athlete's own
// door — the profile shows nothing recruiting-related until the scout
// program) and the Edit Profile dialog's Recruiting tab, which a GUARDIAN
// opens acting as a supervised athlete. One form, two hosts, no drift. The
// ids are the e2e hooks (`#recruiting_school`, the "Recruiting status"
// radiogroup); keep them.

interface Props {
  value: RecruitingForm;
  onChange: (next: RecruitingForm) => void;
  disabled?: boolean;
}

export default function RecruitingFields({ value, onChange, disabled = false }: Props) {
  const set = (patch: Partial<RecruitingForm>) => onChange({ ...value, ...patch });
  return (
    <div className="space-y-6">
      <fieldset disabled={disabled}>
        <legend className="block text-sm font-medium text-secondary mb-2">Recruiting status</legend>
        <div className="space-y-2" role="radiogroup" aria-label="Recruiting status">
          {RECRUITING_STATUSES.map(status => (
            <label key={status} className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer ${value.status === status ? 'border-brand bg-brand-soft' : 'border-border hover:border-border-strong'}`}>
              <input
                type="radio"
                name="recruiting_status"
                value={status}
                checked={value.status === status}
                onChange={() => set({ status })}
                className="mt-1"
              />
              <span>
                <span className="block text-sm font-medium text-primary">{RECRUITING_STATUS_LABEL[status]}</span>
                <span className="block text-xs text-tertiary">
                  {status === 'closed'
                    ? 'Scouts cannot find you.'
                    : status === 'open'
                      ? 'Coaches and scouts can find you in Scout search, with your school, grad year and academics.'
                      : 'Shows where you landed; scouts can still find you.'}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div>
        <label htmlFor="recruiting_school" className="block text-sm font-medium text-secondary mb-1">School</label>
        <input
          id="recruiting_school"
          type="text"
          maxLength={SCHOOL_MAX}
          value={value.school}
          disabled={disabled}
          onChange={e => set({ school: e.target.value })}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="Your school"
        />
        <p className="mt-1 text-xs text-muted">Grad year is your class year on the Vitals tab.</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="recruiting_gpa" className="block text-sm font-medium text-secondary mb-1">GPA (self-reported)</label>
          <input
            id="recruiting_gpa"
            type="number"
            inputMode="decimal"
            min="0"
            max="5"
            step="0.01"
            value={value.gpa}
            disabled={disabled}
            onChange={e => set({ gpa: e.target.value })}
            className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
            placeholder="3.80"
          />
        </div>
        <div>
          <label htmlFor="recruiting_level" className="block text-sm font-medium text-secondary mb-1">Looking at</label>
          <select
            id="recruiting_level"
            value={value.target_level}
            disabled={disabled}
            onChange={e => set({ target_level: (e.target.value || '') as '' | TargetLevel })}
            className="w-full px-3 py-2 border border-border-strong rounded-md bg-surface focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          >
            <option value="">Not set</option>
            {TARGET_LEVELS.map(l => (
              <option key={l} value={l}>{TARGET_LEVEL_LABEL[l]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="recruiting_notes" className="block text-sm font-medium text-secondary mb-1">Academic notes</label>
        <textarea
          id="recruiting_notes"
          rows={3}
          maxLength={ACADEMIC_NOTES_MAX}
          value={value.academic_notes}
          disabled={disabled}
          onChange={e => set({ academic_notes: e.target.value })}
          className="w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          placeholder="Honours, intended major, test scores you want to share…"
        />
        <p className="mt-1 text-xs text-muted">{value.academic_notes.length}/{ACADEMIC_NOTES_MAX}. Contact stays through messages — no email is shown.</p>
      </div>
    </div>
  );
}
