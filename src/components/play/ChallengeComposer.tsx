'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { challengeLine, challengeMetrics, MAX_DAYS } from '@/lib/play/challenges';

/**
 * Send a friend challenge — the Play program (244). Every sport: the metric
 * list is the sport's own vocabulary (challengeMetrics). Opened from the
 * Stats layer's Challenges panel, or from one of the athlete's OWN results
 * (prefilled: "Beat my 78 at Eagle Creek"). Mutual follows only — the
 * picker lists exactly who may be challenged. Discarding typed input asks
 * first (the house useDirtyClose + ConfirmModal).
 *
 * Its OWN dialog, not a LargerWindow: that one is for read-only content
 * (never useDirtyClose) and sits at z-50 — under PostDetailModal (z-[60]),
 * where a post's "Challenge a friend" is often tapped. So: portaled to
 * <body> at z-[65] (the media editor's precedent), a bottom sheet on a
 * phone, a centered card from sm:, and the discard confirm above it.
 */

export interface ChallengePrefill {
  metric: string;
  target: number;
  holes?: 9 | 18 | null;
  sourceKey?: string | null;
  courseName?: string | null;
}

const DAY_CHOICES = [7, 14, 30, 60, MAX_DAYS];

const addDays = (days: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** YYYY-MM-DD in the device's zone. */
function localDateOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export default function ChallengeComposer({ sportKey, prefill, onClose, onSent }: { sportKey: string; prefill?: ChallengePrefill | null; onClose: () => void; onSent?: () => void }) {
  const { showSuccess } = useToast();
  const metrics = useMemo(() => challengeMetrics(sportKey), [sportKey]);
  const [people, setPeople] = useState<Array<{ id: string; name: string }> | null>(null);
  // A failed people read is not "none yet" — the list says so and offers a retry.
  const [peopleError, setPeopleError] = useState(false);
  const [personId, setPersonId] = useState('');
  const [metric, setMetric] = useState(prefill?.metric ?? metrics[0]?.key ?? '');
  const [target, setTarget] = useState(prefill ? String(prefill.target) : '');
  const [holes, setHoles] = useState<9 | 18>(prefill?.holes === 9 ? 9 : 18);
  const [sameCourse, setSameCourse] = useState(!!prefill?.courseName);
  const [days, setDays] = useState(30);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [peopleTry, setPeopleTry] = useState(0);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/challenges/people', { credentials: 'include' });
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { people: Array<{ id: string; name: string }> };
        if (!cancelled) {
          setPeople(body.people);
          setPeopleError(false);
        }
      } catch {
        if (!cancelled) {
          setPeople([]);
          setPeopleError(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [peopleTry]);

  const dirty = () => personId !== '' || message.trim() !== '' || (prefill ? target !== String(prefill.target) : target !== '');
  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } = useDirtyClose(dirty, onClose);

  // A real dialog: the scroll behind stays put, focus moves in, Escape asks
  // (the topmost-dialog rule — the discard confirm owns the key while up).
  useBodyScrollLock(true);
  const dialogRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    dialogRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs.length > 0 && dialogs[dialogs.length - 1] !== dialogRef.current) return;
      requestClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [requestClose]);

  const def = metrics.find(m => m.key === metric);
  const numeric = Number(target);
  const isGolf = sportKey === 'golf';
  const needsHoles = isGolf && (metric === 'gross' || metric === 'to_par' || metric === 'putts');
  const preview = def && target !== '' && Number.isFinite(numeric)
    ? challengeLine({
        sport_key: sportKey,
        metric,
        direction: def.direction,
        target: numeric,
        course_id: null,
        min_holes: needsHoles ? holes : null,
        starts_on: addDays(0),
        ends_on: addDays(days),
        courseName: sameCourse ? prefill?.courseName ?? null : null,
      })
    : null;

  const send = async () => {
    setError(null);
    if (!personId) return setError('Pick who to challenge.');
    if (!def || target === '' || !Number.isFinite(numeric)) return setError('Set a target.');
    setBusy(true);
    try {
      const res = await fetch('/api/challenges', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          challengeeId: personId,
          sportKey,
          metric,
          target: numeric,
          days,
          holes: needsHoles ? holes : null,
          message: message.trim() || null,
          sourceKey: prefill?.sourceKey ?? null,
          sameCourse: isGolf && sameCourse,
          // The window starts on the challenger's own day (their local date).
          today: localDateOf(new Date()),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(body.error ?? 'Could not send the challenge.');
        return;
      }
      showSuccess('Challenge sent', `${people?.find(p => p.id === personId)?.name ?? 'Your friend'} will get a bell to accept.`);
      onSent?.();
      onClose(); // a successful send never asks to discard
    } catch {
      setError('Could not send the challenge.');
    } finally {
      setBusy(false);
    }
  };

  const field = 'w-full min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary';

  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <div
        className="fixed inset-0 bg-black/50 z-[65] flex items-end sm:items-center justify-center ea-backdrop-fade"
        onClick={e => {
          if (e.target === e.currentTarget) requestClose();
        }}
      >
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby="challenge-composer-title"
          tabIndex={-1}
          className="bg-surface-raised w-full sm:max-w-md max-h-modal overflow-y-auto rounded-t-2xl sm:rounded-xl shadow-xl outline-none"
        >
          <div className="sticky top-0 bg-surface-raised flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-border">
            <div>
              <h2 id="challenge-composer-title" className="text-h3 font-bold text-primary">Challenge a friend</h2>
              <p className="text-sm text-muted">{SPORT_NAMES[sportKey] ?? sportKey}</p>
            </div>
            <button type="button" onClick={requestClose} aria-label="Close" className="ea-icon-btn text-secondary">
              <X className="w-5 h-5" aria-hidden />
            </button>
          </div>
          <div className="px-5 py-4">
        <form
          className="space-y-4"
          onSubmit={e => {
            e.preventDefault();
            void send();
          }}
          data-challenge-composer
        >
          <label className="block">
            <span className="text-label font-semibold text-primary">Who</span>
            {people === null ? (
              <div className="mt-1 h-11 rounded-lg bg-surface-sunken animate-pulse" aria-hidden />
            ) : peopleError ? (
              <p className="mt-1 text-sm text-danger-fg">
                Couldn’t load your people.{' '}
                <button type="button" onClick={() => setPeopleTry(n => n + 1)} className="font-semibold underline">
                  Try again
                </button>
              </p>
            ) : people.length === 0 ? (
              <p className="mt-1 text-sm text-muted">You can challenge people you follow who follow you back — none yet.</p>
            ) : (
              <select value={personId} onChange={e => setPersonId(e.target.value)} className={`mt-1 ${field}`} name="challengee">
                <option value="">Pick a friend…</option>
                {people.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-label font-semibold text-primary">What</span>
              <select value={metric} onChange={e => setMetric(e.target.value)} className={`mt-1 ${field}`} name="metric">
                {metrics.map(m => (
                  <option key={m.key} value={m.key}>{m.label}</option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-label font-semibold text-primary">{def?.direction === 'lower' ? 'Beat (under)' : 'Reach'}</span>
              <input
                type="number"
                inputMode={def?.decimal ? 'decimal' : 'numeric'}
                step={def?.decimal ? '0.01' : '1'}
                value={target}
                onChange={e => setTarget(e.target.value)}
                className={`mt-1 ${field}`}
                name="target"
              />
            </label>
          </div>

          {needsHoles && (
            <fieldset>
              <legend className="text-label font-semibold text-primary">Round</legend>
              <div className="mt-1 grid grid-cols-2 gap-2">
                {([18, 9] as const).map(h => (
                  <button key={h} type="button" onClick={() => setHoles(h)} aria-pressed={holes === h}
                    className={`ea-interactive min-h-[44px] rounded-lg border text-sm font-semibold ${holes === h ? 'bg-brand text-white border-brand' : 'bg-surface border-border text-secondary'}`}>
                    {h} holes
                  </button>
                ))}
              </div>
            </fieldset>
          )}

          {isGolf && prefill?.courseName && (
            <label className="flex items-center gap-3 min-h-[44px]">
              <input type="checkbox" checked={sameCourse} onChange={e => setSameCourse(e.target.checked)} className="w-5 h-5" />
              <span className="text-sm text-primary">At {prefill.courseName}</span>
            </label>
          )}

          <label className="block">
            <span className="text-label font-semibold text-primary">How long</span>
            <select value={days} onChange={e => setDays(Number(e.target.value))} className={`mt-1 ${field}`} name="days">
              {DAY_CHOICES.map(d => (
                <option key={d} value={d}>{d} days</option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-label font-semibold text-primary">Message <span className="text-muted font-normal">(optional)</span></span>
            <input value={message} onChange={e => setMessage(e.target.value.slice(0, 140))} className={`mt-1 ${field}`} name="message" placeholder="Bet you can't." />
          </label>

          {preview && (
            <p className="rounded-lg bg-brand-soft px-4 py-3 text-sm font-semibold text-brand-fg-strong" data-challenge-preview>
              {preview}
            </p>
          )}
          {error && <p className="text-sm text-red-600 dark:text-red-400" role="alert">{error}</p>}

          <button type="submit" disabled={busy || !people || people.length === 0} className="ea-cta w-full min-h-[48px] rounded-lg text-base font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Send challenge'}
          </button>
        </form>
          </div>
        </div>
      </div>
      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        overlayZClass="z-[70]"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
      />
    </>,
    document.body
  );
}
