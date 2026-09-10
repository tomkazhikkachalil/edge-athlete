'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';

// ── The scout's Shortlist toggle (Recruiting skeleton R3) ─────────────────
// Rendered by RecruitingCard only for a scout viewer of an open profile;
// reads its own state, toggles through the gated routes. A 403 on add
// (the athlete closed recruiting since the card loaded) reads as the
// server's message, never a silent no-op.

interface Props {
  athleteId: string;
}

export default function ShortlistButton({ athleteId }: Props) {
  const { showError } = useToast();
  const [state, setState] = useState<'loading' | 'off' | 'on' | 'unsupported'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/scout/shortlist/${athleteId}`, { cache: 'no-store' });
        if (!res.ok || cancelled) {
          if (!cancelled) setState('unsupported');
          return;
        }
        const data = (await res.json()) as { supported: boolean; shortlisted: boolean };
        if (!cancelled) setState(!data.supported ? 'unsupported' : data.shortlisted ? 'on' : 'off');
      } catch {
        if (!cancelled) setState('unsupported');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [athleteId]);

  if (state === 'loading' || state === 'unsupported') return null;

  const toggle = async () => {
    setBusy(true);
    try {
      const res = state === 'on'
        ? await fetch(`/api/scout/shortlist/${athleteId}`, { method: 'DELETE' })
        : await fetch('/api/scout/shortlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ athleteId }) });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        showError('Shortlist', err.error || 'Could not update your shortlist');
        return;
      }
      setState(state === 'on' ? 'off' : 'on');
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={busy}
      aria-pressed={state === 'on'}
      data-shortlist-button={state}
      className={`inline-flex items-center gap-2 min-h-[44px] px-3 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
        state === 'on' ? 'bg-brand-soft text-brand-fg-strong border border-violet-200 dark:border-violet-800' : 'bg-brand text-white hover:bg-brand-hover'
      }`}
    >
      <i className="fas fa-bookmark text-xs" aria-hidden="true"></i>
      {state === 'on' ? 'Shortlisted' : 'Shortlist'}
    </button>
  );
}
