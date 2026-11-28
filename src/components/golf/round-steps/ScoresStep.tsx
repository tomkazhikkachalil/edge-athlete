'use client';

import { useId, useState } from 'react';
import InfoToggle from '@/components/mech/InfoToggle';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';
import { playerColour } from '@/lib/golf/player-colour';
import { NO_SCORES_YET } from '@/lib/golf/played-scores';

/**
 * An already-played round's Scores step (Nov 27 2026; Tom: rounds already
 * played, outdoor and indoor, follow the live round).
 *
 * One row per player, in the round's order: the picture ringed in the
 * player's colour (the colour their tab wears on the scoring card), the
 * name, and what has been entered ("18 holes · 82 · +10", "5 of 18 holes ·
 * 23 · +3", "No scores yet"). A row is a key: it opens the live round's
 * scoring card on that player, where the tabs move between players. The
 * step owns no scores; the composer holds them until Create Post.
 */
export interface ScoresStepPlayer {
  id: string;
  name: string;
  avatar_url?: string;
  isSelf: boolean;
  /** `playedCardLine` of this player's row. */
  line: string;
}

interface ScoresStepProps {
  players: readonly ScoresStepPlayer[];
  /** The indoor round's putting rule in one line, when it fixes the putts. */
  ruleLine?: string | null;
  onOpen: (playerId: string) => void;
}

export default function ScoresStep({ players, ruleLine = null, onOpen }: ScoresStepProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const infoId = useId();

  return (
    <div data-round-step="scores" className="flex flex-col gap-2.5">
      <div>
        <div className="flex h-7 items-center justify-between">
          <h3 className="ea-mech-micro" data-round-scores-heading="">Scores</h3>
          <InfoToggle
            open={infoOpen}
            onToggle={() => setInfoOpen(o => !o)}
            label="More information about Scores"
            controls={infoId}
            className="-mr-2"
          />
        </div>
        {infoOpen && (
          <p id={infoId} className="ea-mech-panel mt-2 rounded-xl px-3.5 py-3 text-xs leading-4 text-[color:var(--mech-text-dim)]" data-round-scores-info="">
            Tap a player to enter their round hole by hole. A part of a round is fine: the holes you enter are the round. A player left without scores gets no card.
          </p>
        )}
      </div>

      <ul className="ea-mech-panel overflow-hidden rounded-2xl" data-round-scores="">
        {players.map((player, i) => {
          const entered = player.line !== NO_SCORES_YET;
          return (
            <li key={player.id} style={i > 0 ? { borderTop: '1px solid var(--mech-divider)' } : undefined}>
              <button
                type="button"
                onClick={() => onOpen(player.id)}
                aria-label={`${entered ? 'Edit' : 'Enter'} scores for ${player.isSelf ? 'you' : player.name}`}
                data-round-score-row={player.id}
                {...(entered ? { 'data-entered': '' } : {})}
                className="ea-mech-btn ea-mech-press flex min-h-16 w-full items-center gap-3 px-3 text-left"
              >
                <span className="relative block h-[36px] w-[36px] shrink-0 rounded-full">
                  <AvatarImage src={player.avatar_url} alt="" size={36} fallbackInitials={getInitials(player.name)} />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full" style={{ boxShadow: `inset 0 0 0 2px ${playerColour(i)}` }} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate text-sm font-semibold text-[color:var(--mech-text)]">{player.isSelf ? 'You' : player.name}</span>
                  <span
                    className={`ea-mech-readout truncate text-xs ${entered ? '!text-[color:var(--mech-text-dim)]' : '!text-[color:var(--mech-label)]'}`}
                    data-round-score-line=""
                  >
                    {player.line}
                  </span>
                </span>
                <span className="ea-mech-micro shrink-0" style={{ color: 'var(--mech-accent-light)' }} aria-hidden="true">
                  {entered ? 'Edit' : 'Enter'}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {ruleLine && (
        <p className="text-xs leading-4 text-[color:var(--mech-text-soft)]" data-round-scores-rule="">{ruleLine}</p>
      )}
    </div>
  );
}
