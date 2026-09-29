import { BadgeCheck } from 'lucide-react';
import { shareDate, type ShareCard } from '@/lib/play/share-card';

/**
 * The result card as HTML — the public /r/[postId] page (the Play program,
 * 244). Server-safe on purpose (no hooks, no client state): the page is
 * viewer-independent, and the same projection draws the 1200×630 image
 * (card.png), so the link preview and the page match.
 */
// Literal classes (JIT purges interpolated ones): the row splits evenly however many chips there are.
const CHIP_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

export default function ResultShareCard({ card }: { card: ShareCard }) {
  return (
    <article
      className="ea-surface rounded-xl overflow-hidden bg-surface"
      aria-label={card.title}
      data-share-card={card.kind}
    >
      <div className="bg-gradient-to-br from-violet-700 to-violet-500 text-white px-6 py-8 sm:px-8">
        <p className="text-sm font-semibold uppercase tracking-wide text-white/80">{card.sportName}</p>
        <h1 className="text-h2 font-bold mt-1 break-words">{card.athleteName}</h1>
        {card.subline && <p className="text-base text-white/90 mt-1 break-words">{card.subline}</p>}
        <div className="flex items-end gap-3 mt-6">
          <span className="text-6xl sm:text-7xl font-extrabold leading-none" data-share-hero>
            {card.hero.value}
          </span>
          <span className="text-lg font-semibold text-white/90 pb-1">{card.hero.label}</span>
        </div>
      </div>
      {card.chips.length > 0 && (
        <dl className={`grid ${CHIP_COLS[card.chips.length] ?? 'grid-cols-3'} divide-x divide-border border-b border-border`}>
          {card.chips.map(chip => (
            <div key={chip.label} className="px-3 py-4 text-center min-w-0">
              <dt className="text-xs text-muted truncate">{chip.label}</dt>
              <dd className="text-h3 font-bold text-primary">{chip.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="flex items-center justify-between gap-3 px-6 py-4 sm:px-8 text-sm">
        <span className="text-muted">{shareDate(card.date)}</span>
        {card.verified ? (
          <span className="inline-flex items-center gap-1.5 font-semibold text-brand">
            <BadgeCheck className="w-4 h-4" aria-hidden /> Verified result
          </span>
        ) : (
          <span className="text-muted">Self-reported</span>
        )}
      </div>
    </article>
  );
}
