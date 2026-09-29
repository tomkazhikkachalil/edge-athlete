'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BadgeCheck, Zap } from 'lucide-react';
import { useToast } from '@/components/Toast';
import ChallengeComposer from './ChallengeComposer';
import type { ChallengeStatus } from '@/lib/play/challenges';
import { SPORT_NAMES } from '@/lib/config/sports-config';

/**
 * The athlete's friend challenges in one sport — the Play program (244).
 * The Stats hub's sport layer, OWN profile only (challenges are between two
 * people; nobody else's business). Open ones first; the challengee answers
 * a pending one here (or from the bell), the challenger can call one off.
 * `?challenge=<id>` (the bells' link) highlights and scrolls to it.
 *
 * `sportKey: null` is the All view's panel: every sport's challenges, each
 * named by sport, and nothing at all while there are none — a challenge to
 * someone with no results in that sport yet (no sport layer to show it in)
 * still has a home. The sport layer's panel carries "Challenge a friend".
 */

interface ChallengeItem {
  id: string;
  sport_key: string;
  role: 'challenger' | 'challengee';
  otherName: string;
  line: string;
  message: string | null;
  status: ChallengeStatus;
  ends_on: string;
  settled_value: number | null;
  verified: boolean;
}

const STATUS_LOOK: Record<ChallengeStatus, { label: string; cls: string }> = {
  pending: { label: 'Waiting', cls: 'bg-surface-sunken text-secondary' },
  accepted: { label: 'On', cls: 'bg-brand-soft text-brand-fg-strong' },
  won: { label: 'Won', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200' },
  lost: { label: 'Missed', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-200' },
  declined: { label: 'Passed', cls: 'bg-surface-sunken text-muted' },
  cancelled: { label: 'Called off', cls: 'bg-surface-sunken text-muted' },
  expired: { label: 'Expired', cls: 'bg-surface-sunken text-muted' },
};

const OPEN = new Set<ChallengeStatus>(['pending', 'accepted']);

function daysLeft(endsOn: string): number {
  const [y, m, d] = endsOn.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((end - today) / 86_400_000));
}

function who(c: ChallengeItem): string {
  if (c.status === 'won') return c.role === 'challengee' ? `You answered ${c.otherName}'s challenge` : `${c.otherName} met your challenge`;
  return c.role === 'challenger' ? `You challenged ${c.otherName}` : `${c.otherName} challenged you`;
}

export default function ChallengesPanel({ sportKey }: { sportKey: string | null }) {
  const { showError } = useToast();
  const [items, setItems] = useState<ChallengeItem[] | null>(null);
  const [composing, setComposing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [focusId] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('challenge')));
  const focusRef = useRef<HTMLLIElement | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/challenges', { credentials: 'include' });
      const body = res.ok ? ((await res.json()) as { challenges: ChallengeItem[] }) : { challenges: [] };
      setItems(sportKey ? body.challenges.filter(c => c.sport_key === sportKey) : body.challenges);
    } catch {
      setItems([]);
    }
  }, [sportKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => { cancelled = true; };
  }, [load]);

  useEffect(() => {
    if (items && focusId && focusRef.current) focusRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [items, focusId]);

  const act = async (id: string, action: 'accept' | 'decline' | 'cancel') => {
    setBusy(id);
    try {
      const res = await fetch(`/api/challenges/${id}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        showError('Could not update the challenge', body.error ?? 'Please try again.');
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  if (!items) return null;
  if (sportKey === null && items.length === 0) return null;
  const allSports = sportKey === null;
  // What needs YOU first (a challenge waiting on your answer), then the open ones, then the record.
  const rank = (c: ChallengeItem) => (c.status === 'pending' && c.role === 'challengee' ? 0 : OPEN.has(c.status) ? 1 : 2);
  const sorted = [...items].sort((a, b) => rank(a) - rank(b));

  return (
    <section className="ea-surface rounded-xl bg-surface p-4 sm:p-6 mb-6" aria-labelledby={`challenges-${sportKey ?? 'all'}`} data-challenges={sportKey ?? 'all'}>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-brand" aria-hidden />
          <h3 id={`challenges-${sportKey ?? 'all'}`} className="text-h3 text-primary">{allSports ? 'Your challenges' : 'Challenges'}</h3>
        </div>
        {!allSports && (
          <button type="button" onClick={() => setComposing(true)} className="ea-cta min-h-[44px] px-4 rounded-lg text-sm font-semibold text-white whitespace-nowrap" data-challenge-new>
            Challenge a friend
          </button>
        )}
      </div>
      <p className="text-sm text-muted mb-4">Settled by real results — a verified one is marked.</p>

      {sorted.length === 0 ? (
        <p className="text-sm text-muted border border-dashed border-border rounded-lg px-4 py-5 text-center">
          No challenges yet. Dare a friend to beat your best.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map(c => {
            const look = c.status === 'pending' && c.role === 'challengee' ? { label: 'Your move', cls: 'bg-brand text-white' } : STATUS_LOOK[c.status];
            const focused = c.id === focusId;
            return (
              <li
                key={c.id}
                ref={focused ? focusRef : undefined}
                className={`py-3 ${focused ? 'rounded-lg ring-2 ring-brand px-3 -mx-3' : ''}`}
                data-challenge={c.id}
                data-challenge-status={c.status}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm text-muted">{who(c)}{allSports ? ` · ${SPORT_NAMES[c.sport_key] ?? c.sport_key}` : ''}</p>
                    <p className="font-bold text-primary break-words">{c.line}</p>
                    {c.message && <p className="text-sm text-secondary italic mt-0.5 break-words">“{c.message}”</p>}
                    <p className="text-xs text-muted mt-1">
                      {c.status === 'won' && c.settled_value !== null ? (
                        <span className="inline-flex items-center gap-1">
                          Answered with {c.settled_value}
                          {c.verified && (<><BadgeCheck className="w-3.5 h-3.5 text-brand" aria-hidden /> verified</>)}
                        </span>
                      ) : OPEN.has(c.status) ? (
                        `${daysLeft(c.ends_on)} days left`
                      ) : null}
                    </p>
                  </div>
                  <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${look.cls}`}>{look.label}</span>
                </div>
                {c.status === 'pending' && c.role === 'challengee' && (
                  <div className="mt-2 flex gap-2">
                    <button type="button" disabled={busy === c.id} onClick={() => act(c.id, 'accept')} className="ea-interactive min-h-[44px] px-4 rounded-lg bg-brand text-white text-sm font-semibold disabled:opacity-60">
                      Accept
                    </button>
                    <button type="button" disabled={busy === c.id} onClick={() => act(c.id, 'decline')} className="ea-interactive min-h-[44px] px-4 rounded-lg border border-border text-sm font-semibold text-secondary disabled:opacity-60">
                      Pass
                    </button>
                  </div>
                )}
                {OPEN.has(c.status) && c.role === 'challenger' && (
                  <button type="button" disabled={busy === c.id} onClick={() => act(c.id, 'cancel')} className="mt-2 ea-interactive min-h-[44px] px-3 rounded-lg text-sm font-semibold text-muted disabled:opacity-60">
                    Call it off
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {composing && sportKey && <ChallengeComposer sportKey={sportKey} onClose={() => setComposing(false)} onSent={load} />}
    </section>
  );
}
