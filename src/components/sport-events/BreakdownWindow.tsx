'use client';

import { useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import type { PlayerBreakdown } from '@/lib/sport-events/breakdown';
import type { EventBreakdown } from '@/lib/sport-events/breakdown-server';
import { formatToPar } from '@/lib/sport-events/leaderboard';
import HoleStrip from './HoleStrip';

/**
 * A player's breakdown (Events program, phase 2) — the house bottom sheet
 * opened from a board row: the hole strip per round, then the tiles a
 * golfer reads (front / back, par 3s / 4s / 5s, eagles → double-plus,
 * putts, fairways, greens, penalties — a tile hides when nothing was
 * tracked). "This round / All rounds" on a tournament. Two columns at
 * phone width, four from `sm:`.
 */
interface Props {
  player: { participantId: string; name: string; rankLabel?: string };
  data: EventBreakdown | null;
  /** The round the board showed, or null for the overall board. */
  roundId: string | null;
  onClose: () => void;
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-muted rounded-lg px-3 py-2 min-w-0" data-breakdown-tile={label}>
      <p className="text-[11px] uppercase tracking-wide text-muted truncate">{label}</p>
      <p className="text-lg font-bold text-primary tabular-nums leading-tight">{value}</p>
      {sub && <p className="text-xs text-secondary">{sub}</p>}
    </div>
  );
}

function Tiles({ b }: { b: PlayerBreakdown }) {
  const pct = (hit: number, tracked: number) => `${Math.round((hit / tracked) * 100)}%`;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-breakdown-tiles="">
      {b.front.holes > 0 && <Tile label="Front" value={String(b.front.strokes)} sub={`${formatToPar(b.front.toPar)} · ${b.front.holes} holes`} />}
      {b.back.holes > 0 && <Tile label="Back" value={String(b.back.strokes)} sub={`${formatToPar(b.back.toPar)} · ${b.back.holes} holes`} />}
      {([3, 4, 5] as const).map(k => b.byPar[k].holes > 0 && <Tile key={k} label={`Par ${k}s`} value={b.byPar[k].avg === null ? '—' : b.byPar[k].avg.toFixed(2)} sub={`${formatToPar(b.byPar[k].toPar)} over ${b.byPar[k].holes}`} />)}
      {b.byPar[6].holes > 0 && <Tile label="Par 6s" value={b.byPar[6].avg === null ? '—' : b.byPar[6].avg.toFixed(2)} sub={`${formatToPar(b.byPar[6].toPar)} over ${b.byPar[6].holes}`} />}
      <Tile label="Eagles" value={String(b.counts.eagle)} />
      <Tile label="Birdies" value={String(b.counts.birdie)} />
      <Tile label="Pars" value={String(b.counts.par)} />
      <Tile label="Bogeys" value={String(b.counts.bogey)} />
      <Tile label="Double+" value={String(b.counts.doublePlus)} />
      {b.putts.tracked > 0 && <Tile label="Putts" value={b.putts.perHole === null ? '—' : b.putts.perHole.toFixed(2)} sub={`per hole · ${b.putts.total} over ${b.putts.tracked}`} />}
      {b.fir.tracked > 0 && <Tile label="Fairways" value={pct(b.fir.hit, b.fir.tracked)} sub={`${b.fir.hit} of ${b.fir.tracked}`} />}
      {b.gir.tracked > 0 && <Tile label="Greens" value={pct(b.gir.hit, b.gir.tracked)} sub={`${b.gir.hit} of ${b.gir.tracked}`} />}
      {b.penalties > 0 && <Tile label="Penalties" value={String(b.penalties)} />}
    </div>
  );
}

export default function BreakdownWindow({ player, data, roundId, onClose }: Props) {
  const many = (data?.rounds.length ?? 0) > 1;
  const [scope, setScope] = useState<'round' | 'all'>(roundId ? 'round' : 'all');
  const rounds = data?.rounds ?? [];
  const shown = scope === 'round' && roundId ? rounds.filter(r => r.round.id === roundId) : rounds;
  const inRound = (rid: string) => rounds.find(r => r.round.id === rid)?.players.find(p => p.participantId === player.participantId) ?? null;
  const tiles: PlayerBreakdown | null = scope === 'all' && many
    ? data?.overall?.players.find(p => p.participantId === player.participantId)?.breakdown ?? null
    : (shown[0] ? inRound(shown[0].round.id)?.breakdown ?? null : null);
  return (
    <LargerWindow title={player.name} subtitle={player.rankLabel ? `Position ${player.rankLabel}` : undefined} onClose={onClose} windowKey="event-breakdown">
      <div className="space-y-4" data-breakdown-scope={scope}>
        {many && (
          <div className="flex rounded-lg border border-border-strong overflow-hidden w-fit" role="group" aria-label="Rounds shown">
            {(['round', 'all'] as const).map(s => (
              <button key={s} type="button" onClick={() => setScope(s)} aria-pressed={scope === s} disabled={s === 'round' && !roundId} data-breakdown-pick={s} className={`h-10 px-4 text-sm font-medium transition disabled:opacity-50 ${scope === s ? 'bg-brand text-white' : 'bg-surface text-tertiary hover:text-brand-fg'}`}>
                {s === 'round' ? 'This round' : 'All rounds'}
              </button>
            ))}
          </div>
        )}
        {!data && <div className="flex justify-center py-8" aria-busy="true"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div>}
        {data && shown.length === 0 && <p className="text-sm text-muted">No round has been played yet.</p>}
        {shown.map(r => {
          const p = inRound(r.round.id);
          return (
            <section key={r.round.id} className="space-y-2" data-breakdown-round={r.round.id}>
              <HoleStrip holes={p?.holes ?? []} pars={r.round.pars} label={many ? `Round ${r.round.sequence} · ${r.round.course_name}` : r.round.course_name} />
            </section>
          );
        })}
        {tiles && (tiles.played > 0 ? <Tiles b={tiles} /> : <p className="text-sm text-muted">No holes scored yet.</p>)}
      </div>
    </LargerWindow>
  );
}
