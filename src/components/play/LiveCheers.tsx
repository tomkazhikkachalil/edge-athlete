'use client';

import Link from 'next/link';
import { createPortal } from 'react-dom';
import { CHEERS } from '@/lib/play/cheers';
import { useCheers } from '@/hooks/useCheers';
import { useToast } from '@/components/Toast';

/**
 * The cheer bar on a live round — the Play program (244), every sport
 * (the golf live page, a stat event's live screen). Six emoji; a tap floats
 * it up for everyone watching (the next poll), and the counts ride beside
 * each. Anonymous by design: no name ever rides a cheer. Signed out, the
 * counts show and the bar says how to join in. Renders nothing until the
 * round has something to show — a round that is not live and was never
 * cheered stays quiet.
 */
export default function LiveCheers({ contextKey, signedIn }: { contextKey: string; signedIn: boolean }) {
  const { totals, total, live, ready, floats, send } = useCheers(contextKey);
  const { showInfo } = useToast();
  if (!ready || (!live && total === 0)) return null;

  const onTap = async (key: (typeof CHEERS)[number]['key']) => {
    const out = await send(key);
    if (out === 'slow_down') showInfo('Easy there', 'Cheers are cooling down — try again in a moment.');
    else if (out === 'not_live') showInfo('This round has finished', 'Cheers are for live rounds.');
    else if (out === 'error') showInfo('Your cheer did not send', 'Please try again.');
  };

  return (
    <section className="mt-4 ea-surface rounded-lg bg-surface p-3" aria-label="Cheers" data-cheers={contextKey}>
      {/* The floats: fixed over the page so a scorer sees them wherever they are; never interactive.
          Portaled to <body> — a transformed ancestor would pin a fixed layer to itself (the v4 stacking trap).
          z-[70]: ABOVE the score-entry sheet and the house modals (z-[60]) — a player mid-entry must see
          the cheer — and below toasts (80); pointer-events-none, so it never blocks a tap. */}
      {floats.length > 0 && typeof document !== 'undefined' && createPortal(
        <div className="pointer-events-none fixed inset-x-0 bottom-24 h-0 z-[70]" aria-hidden>
          {floats.map(f => (
            <span key={f.id} className="ea-cheer-float absolute bottom-0 text-3xl" style={{ left: `${f.left}%` }} data-cheer-float>
              {f.emoji}
            </span>
          ))}
        </div>,
        document.body
      )}
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-label font-semibold text-primary">{live ? 'Cheer them on' : 'Cheers'}</p>
        <p className="text-xs text-muted" data-cheers-total>{total} {total === 1 ? 'cheer' : 'cheers'}</p>
      </div>
      <div className="grid grid-cols-6 gap-1.5">
        {CHEERS.map(c => (
          <button
            key={c.key}
            type="button"
            onClick={() => onTap(c.key)}
            disabled={!live || !signedIn}
            aria-label={`${c.label} — ${totals[c.key]}`}
            data-cheer={c.key}
            className="ea-interactive flex flex-col items-center justify-center min-h-[52px] rounded-lg bg-surface-sunken disabled:opacity-60"
          >
            <span className="text-2xl leading-none" aria-hidden>{c.emoji}</span>
            <span className="text-xs text-secondary tabular-nums mt-0.5">{totals[c.key]}</span>
          </button>
        ))}
      </div>
      {live && !signedIn && (
        <p className="text-xs text-muted mt-2 text-center">
          <Link href="/" className="font-semibold text-brand hover:underline">Log in</Link> to cheer.
        </p>
      )}
    </section>
  );
}
