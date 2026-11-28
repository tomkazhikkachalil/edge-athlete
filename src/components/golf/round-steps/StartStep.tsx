'use client';

import { Fragment, useState, type ReactNode } from 'react';
import InfoToggle from '@/components/mech/InfoToggle';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';

/**
 * The golf round's last step: what is about to start (or, for an
 * already-played round, be created), on one plate.
 *
 * Tom's part 2 spec (Nov 24 2026 — the mechanical dialect): a lamp in the
 * live red and "Ready to go live"; one row per fact (micro label left, the
 * value right, its numbers in the fixed-width face); the players with their
 * handicap index. The sentence that used to sit under the summary is behind
 * the info button: while it is open the TITLE is replaced in place, so
 * nothing below moves. Preview is gone — this screen is the preview — and
 * nothing here enters a score.
 *
 * `children` is the composer's caption + media block, drawn under the plate
 * for an already-played round only (a live round tells its story at the end).
 */
export interface StartRow {
  /** The row's hook: `data-round-summary-row`. */
  key: string;
  label: string;
  value: string | null;
}

interface StartStepProps {
  alreadyPlayed: boolean;
  rows: readonly StartRow[];
  players: readonly { id: string; name: string; avatar_url?: string }[];
  handicaps: Readonly<Record<string, string | null>>;
  /** An already-played round: each player's entered card in one line
   *  ("18 holes · 82 · +10"), under their name. Absent for a live round. */
  scores?: Readonly<Record<string, string>>;
  children?: ReactNode;
}

/** The value with every number in the fixed-width face. */
function Value({ text }: { text: string }) {
  const parts = text.split(/(\d[\d.,]*\d|\d)/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? <span key={i} className="ea-mech-readout">{part}</span> : <Fragment key={i}>{part}</Fragment>
      )}
    </>
  );
}

export default function StartStep({ alreadyPlayed, rows, players, handicaps, scores, children }: StartStepProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const title = alreadyPlayed ? 'Your round' : 'Ready to go live';
  const info = alreadyPlayed
    ? 'Create Post saves the round and opens it for review. You post it from there.'
    : 'Go Live opens the round. Score hole by hole, add partners any time.';

  return (
    <div className="flex flex-col gap-2.5" data-round-step="finish">
      <div className="ea-mech-panel rounded-2xl px-3.5 pb-2 pt-1.5">
        <div className="flex h-11 items-center gap-2.5">
          {!alreadyPlayed && (
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: 'var(--mech-live)', boxShadow: '0 0 10px var(--mech-live-glow)' }}
              data-round-lamp=""
            />
          )}
          {infoOpen ? (
            <p id="golf-start-info" className="min-w-0 flex-1 text-xs leading-4 text-[color:var(--mech-text-dim)]" data-round-start-info="">{info}</p>
          ) : (
            <h3 className="min-w-0 flex-1 truncate text-base font-semibold text-[color:var(--mech-text)]">{title}</h3>
          )}
          <InfoToggle
            open={infoOpen}
            onToggle={() => setInfoOpen(o => !o)}
            label={`More information about ${title}`}
            controls="golf-start-info"
            className="-mr-2"
          />
        </div>

        <dl data-round-summary="">
          {rows.map(row => (
            <div
              key={row.key}
              className="flex min-h-10 items-center justify-between gap-3 py-1"
              style={{ borderTop: '1px solid var(--mech-divider)' }}
              data-round-summary-row={row.key}
            >
              <dt className="ea-mech-micro shrink-0">{row.label}</dt>
              <dd className={`min-w-0 text-right text-[13px] ${row.value ? 'font-semibold text-[color:var(--mech-text)]' : 'text-[color:var(--mech-label)]'}`}>
                {row.value ? <Value text={row.value} /> : 'Not set'}
              </dd>
            </div>
          ))}
        </dl>

        <div className="pt-2.5" style={{ borderTop: '1px solid var(--mech-divider)' }} data-round-summary-row="players">
          <p className="ea-mech-micro">Players</p>
          <ul>
            {players.map(p => {
              const handicap = handicaps[p.id];
              return (
                <li key={p.id} data-round-player={p.id} className={`flex items-center gap-2.5 ${scores ? 'min-h-11 py-1' : 'h-10'}`}>
                  <AvatarImage src={p.avatar_url} alt="" size={28} fallbackInitials={getInitials(p.name)} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-[13px] font-semibold text-[color:var(--mech-text)]">{p.name}</span>
                    {scores?.[p.id] ? (
                      <span className="ea-mech-readout truncate text-xs !text-[color:var(--mech-text-dim)]" data-round-player-score="">{scores[p.id]}</span>
                    ) : null}
                  </span>
                  {handicap ? (
                    <span className="flex shrink-0 items-baseline gap-1.5" data-round-player-index="">
                      <span className="ea-mech-micro">Index</span>
                      <span className="ea-mech-readout text-[13px]">{handicap}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
      </div>

      {children}
    </div>
  );
}
