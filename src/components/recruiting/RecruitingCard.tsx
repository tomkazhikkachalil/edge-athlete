'use client';

import { useEffect, useState } from 'react';
import { RECRUITING_STATUS_LABEL, TARGET_LEVEL_LABEL, formatGpa, type RecruitingProfile, type RecruitingStatus } from '@/lib/recruiting/profile';

// ── The recruiting card (Recruiting skeleton R1) ──────────────────────────
// One card, three profile routes (/u/[username], /athlete/[id], /athlete —
// route parity). It reads its OWN endpoint, never the CDN-cached public
// payload: the recruiting GET is where the gate lives (a closed profile
// answers nothing but the status), so this card can never leak academics
// a viewer was not entitled to. Renders nothing while loading, nothing for
// a closed profile a viewer sees, and an honest "not recruiting" line for
// the owner/guardian with the way to change it. Contact is the profile's
// existing message affordance — there is no recruiting email on purpose.

interface Read {
  supported: boolean;
  status: RecruitingStatus;
  statusLabel: string;
  canEdit: boolean;
  school?: string | null;
  gradYearLabel?: string | null;
  profile?: RecruitingProfile;
  supervised?: boolean;
}

interface Props {
  profileId: string;
  /** The owner/guardian's edit affordance (opens the Recruiting tab). */
  onEdit?: () => void;
  /** A keyed refetch after a save. */
  refreshKey?: number;
}

export default function RecruitingCard({ profileId, onEdit, refreshKey = 0 }: Props) {
  const [read, setRead] = useState<Read | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/profile/${profileId}/recruiting`, { cache: 'no-store' });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Read;
        if (!cancelled) setRead(data);
      } catch {
        /* informational — nothing renders */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, refreshKey]);

  if (!read || !read.supported) return null;

  if (read.status === 'closed') {
    if (!read.canEdit) return null;
    return (
      <section aria-label="Recruiting" className="bg-surface rounded-lg border border-border p-4" data-recruiting-card="closed">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-primary">Recruiting</h2>
            <p className="text-sm text-tertiary">{RECRUITING_STATUS_LABEL.closed} — coaches and scouts see nothing here.</p>
          </div>
          {onEdit && (
            <button type="button" onClick={onEdit} className="text-sm font-medium text-brand-fg hover:text-brand-fg-strong min-h-[44px] px-2">
              Open recruiting →
            </button>
          )}
        </div>
      </section>
    );
  }

  const p = read.profile;
  const gpa = formatGpa(p?.gpa);
  const facts = [
    read.school ? { label: 'School', value: read.school } : null,
    read.gradYearLabel ? { label: 'Grad year', value: read.gradYearLabel } : null,
    p?.target_level ? { label: 'Looking at', value: TARGET_LEVEL_LABEL[p.target_level] } : null,
    gpa ? { label: 'GPA', value: `${gpa} · self-reported` } : null,
  ].filter((f): f is { label: string; value: string } => !!f);

  return (
    <section aria-label="Recruiting" className="bg-surface rounded-lg border border-border p-4" data-recruiting-card={read.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-primary">Recruiting</h2>
          <span className={`text-xs px-2 py-0.5 rounded-md border ${read.status === 'open' ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-200 dark:border-emerald-900' : 'bg-surface-muted text-secondary border-border'}`}>
            {read.statusLabel}
          </span>
        </div>
        {read.canEdit && onEdit && (
          <button type="button" onClick={onEdit} className="text-sm font-medium text-brand-fg hover:text-brand-fg-strong min-h-[44px] px-2">
            Edit
          </button>
        )}
      </div>
      {facts.length > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
          {facts.map(f => (
            <div key={f.label} className="min-w-0">
              <dt className="text-xs text-muted">{f.label}</dt>
              <dd className="text-sm text-primary break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {p?.academic_notes && <p className="mt-3 text-sm text-secondary whitespace-pre-line">{p.academic_notes}</p>}
      {read.supervised && read.canEdit && (
        <p className="mt-3 text-xs text-tertiary">A guardian decides whether this athlete is recruiting.</p>
      )}
    </section>
  );
}
