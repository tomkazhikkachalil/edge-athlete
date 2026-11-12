'use client';

import { useMemo, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { cellText, deriveGame, type DerivedGame, type PlayerLine } from '@/lib/videos/game-derive';
import { gameHasSides, gameShowsScore, sideLabel, type GameView } from '@/lib/videos/game-rules';
import { gameSheetFor, periodLabel, type GameSheet, type Side } from '@/lib/videos/game-sheets';
import { gameTagOf, hiddenNote, type RevealMode } from '@/lib/videos/game-view';
import { formatTimestamp } from '@/lib/videos/rules';
import type { HighlightRow } from '@/lib/videos/types';

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The game's stats, built from its tags (Sprint 3 PR 4). For a viewer of a
 * game whose stats are hidden, `mode` is progressive: only the tags the
 * video has played past are counted — the board, the box score and the
 * scoring summary fill in as they watch — and "Show full stats" asks first,
 * because it spoils the game. A manager, an unlocked viewer, and a game
 * with spoilers off see everything. Nothing here is stored: `deriveGame`
 * computes it from the highlights it is handed.
 */
function playerName(p: PlayerLine): string {
  return p.name ?? 'Player';
}

function Board({ sheet, game, d }: { sheet: GameSheet; game: GameView; d: DerivedGame }) {
  return (
    <div data-game-board={`${d.score[1]}-${d.score[2]}`}>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
        <p className="text-sm font-semibold text-primary text-right break-words">{sideLabel(game, 1)}</p>
        <p className="font-mono text-3xl font-bold text-primary tabular-nums" aria-label={`${sideLabel(game, 1)} ${d.score[1]}, ${sideLabel(game, 2)} ${d.score[2]}`}>
          <span data-game-score="1">{d.score[1]}</span><span className="mx-2 text-muted">–</span><span data-game-score="2">{d.score[2]}</span>
        </p>
        <p className="text-sm font-semibold text-primary break-words">{sideLabel(game, 2)}</p>
      </div>
      {d.periods.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="mx-auto text-sm tabular-nums" data-game-periods={d.periods.length}>
            <thead>
              <tr className="text-xs text-muted">
                <th className="px-2 py-1 text-left font-normal">{sheet.scoreMode === 'sets' ? 'Points by set' : `By ${sheet.period.noun.toLowerCase()}`}</th>
                {d.periods.map(p => <th key={p.period} className="px-2 py-1 font-normal">{periodLabel(sheet, p.period)}</th>)}
              </tr>
            </thead>
            <tbody>
              {([1, 2] as Side[]).map(s => (
                <tr key={s}>
                  <td className="px-2 py-1 text-left text-secondary max-w-[9rem] truncate">{sideLabel(game, s)}</td>
                  {d.periods.map(p => <td key={p.period} className="px-2 py-1 text-center text-primary">{p.score[s]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BoxScore({ sheet, title, players }: { sheet: GameSheet; title: string; players: PlayerLine[] }) {
  if (players.length === 0 || sheet.box.length === 0) return null;
  return (
    <div data-game-box={title}>
      <p className="text-sm font-semibold text-primary mb-1">{title}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-xs text-muted border-b border-border">
              <th className="py-1 pr-2 text-left font-normal sticky left-0 bg-surface">Player</th>
              {sheet.box.map(c => <th key={c.label} className="px-2 py-1 text-right font-normal whitespace-nowrap">{c.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {players.map(p => (
              <tr key={`${p.key}|${p.side ?? 0}`} className="border-b border-border-subtle" data-game-player={p.key}>
                <td className="py-1.5 pr-2 text-left text-primary max-w-[9rem] truncate sticky left-0 bg-surface">{playerName(p)}</td>
                {sheet.box.map(c => <td key={c.label} className="px-2 py-1.5 text-right text-primary whitespace-nowrap">{cellText(p.stats, c.key)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function GameStatsPanel({ game, highlights, mode, highWaterMs, onUnlock, onSeek }: { game: GameView; highlights: HighlightRow[]; mode: RevealMode; highWaterMs: number; onUnlock: () => void; onSeek: (ms: number) => void }) {
  const [confirming, setConfirming] = useState(false);
  const sheet = gameSheetFor(game.sport_key);
  const tags = useMemo(() => highlights.map(gameTagOf), [highlights]);
  const derived = useMemo(() => (sheet ? deriveGame(sheet, tags, mode === 'all' ? Number.POSITIVE_INFINITY : highWaterMs) : null), [sheet, tags, mode, highWaterMs]);
  if (!sheet || !derived) return null;

  const total = tags.filter(t => t.eventKey).length;
  const shown = derived.tagIds.length;
  const ahead = total - shown;
  const sides = gameHasSides(game.sport_key);
  const showScore = gameShowsScore(game);
  const bySide = (s: Side | null) => derived.players.filter(p => p.side === s && Object.keys(p.stats).length > 0);
  const teamRows = sheet.team.filter(c => ([1, 2] as Side[]).some(s => (typeof c.key === 'string' ? [c.key] : [...c.key]).some(k => (derived.team[s][k] ?? 0) > 0)));
  const nothingYet = shown === 0;

  return (
    <section className="bg-surface rounded-lg border border-border p-4 sm:p-6 space-y-4" aria-labelledby="game-stats-heading" data-game-stats={mode} data-game-stats-shown={shown} data-game-stats-total={total}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="game-stats-heading" className="text-lg font-bold text-primary flex-1">Game stats</h2>
        {mode === 'progressive' && (
          <button type="button" onClick={() => setConfirming(true)} className={BTN} data-game-unlock="">Show full stats</button>
        )}
      </div>

      {mode === 'progressive' && (
        <p className="text-sm text-secondary" role="status" data-game-spoiler-note="">
          No spoilers: the stats fill in as you watch.{ahead > 0 ? ` ${ahead} tagged ${ahead === 1 ? 'play is' : 'plays are'} still ahead.` : ''}
        </p>
      )}

      {game.coverage === 'highlights' && <p className="text-xs text-muted">Highlights only — no score is shown; these are the tagged plays, not the whole game.</p>}

      {showScore && sides && <Board sheet={sheet} game={game} d={derived} />}

      {derived.result && sides && (
        <p className="text-sm font-semibold text-primary" data-game-result="">
          {derived.result.winner ? `${sideLabel(game, derived.result.winner)} — ` : ''}{derived.result.method}{derived.result.period ? ` · ${periodLabel(sheet, derived.result.period)}` : ''}
        </p>
      )}

      {nothingYet && <p className="text-sm text-muted" data-game-stats-empty="">{total === 0 ? 'Nothing is tagged yet.' : 'Nothing yet — press play.'}</p>}

      {sides
        ? ([1, 2] as Side[]).map(s => <BoxScore key={s} sheet={sheet} title={sideLabel(game, s)} players={bySide(s)} />)
        : <BoxScore sheet={sheet} title="Athletes" players={bySide(null)} />}

      {sides && teamRows.length > 0 && (
        <div data-game-team-stats={teamRows.length}>
          <p className="text-sm font-semibold text-primary mb-1">Team stats</p>
          <table className="w-full text-sm tabular-nums">
            <tbody>
              {teamRows.map(c => (
                <tr key={c.label} className="border-b border-border-subtle">
                  <td className="py-1.5 w-1/4 text-right font-semibold text-primary">{cellText(derived.team[1], c.key)}</td>
                  <td className="py-1.5 px-2 text-center text-secondary">{c.label}</td>
                  <td className="py-1.5 w-1/4 text-left font-semibold text-primary">{cellText(derived.team[2], c.key)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showScore && derived.summary.length > 0 && (
        <div data-game-summary={derived.summary.length}>
          <p className="text-sm font-semibold text-primary mb-1">Scoring summary</p>
          <ol className="divide-y divide-border-subtle">
            {derived.summary.map(row => (
              <li key={row.tagId}>
                <button type="button" onClick={() => onSeek(row.ms)} className="ea-interactive flex w-full items-center gap-3 px-1 min-h-[44px] text-left" data-game-summary-row={row.tagId}>
                  <span className="font-mono text-xs text-brand-fg shrink-0 w-14">{formatTimestamp(row.ms)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm text-primary truncate">{[row.period ? periodLabel(sheet, row.period) : null, row.side ? sideLabel(game, row.side) : null, row.label].filter(Boolean).join(' · ')}</span>
                    {row.people.length > 0 && <span className="block text-xs text-muted truncate">{row.people.map(p => p.name).filter(Boolean).join(', ')}</span>}
                  </span>
                  <span className="font-mono text-sm font-semibold text-primary tabular-nums shrink-0">{row.score[1]}–{row.score[2]}</span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}

      {derived.results.length > 0 && (
        <div data-game-results={derived.results.length}>
          <p className="text-sm font-semibold text-primary mb-1">Results</p>
          <ol className="divide-y divide-border-subtle">
            {derived.results.map((r, i) => (
              <li key={`${r.tagId}|${r.key}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-6 text-muted tabular-nums">{derived.results.filter((x, j) => j <= i && x.event === r.event).length}</span>
                <span className="min-w-0 flex-1 truncate text-primary">{r.name ?? 'Athlete'}{r.event ? <span className="text-muted"> · {r.event}</span> : null}</span>
                <span className="font-mono tabular-nums text-primary">{r.timeMs !== null ? formatTimestamp(r.timeMs) : r.mark !== null ? r.mark : ''}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {derived.holes.length > 0 && (
        <div data-game-holes={derived.holes.length}>
          <p className="text-sm font-semibold text-primary mb-1">Scorecard</p>
          <div className="overflow-x-auto">
            <table className="text-sm tabular-nums">
              <tbody>
                {[...new Set(derived.holes.map(x => x.key))].map(key => {
                  const mine = derived.holes.filter(x => x.key === key);
                  return (
                    <tr key={key} className="border-b border-border-subtle">
                      <td className="py-1.5 pr-3 text-primary max-w-[9rem] truncate">{mine[0].name ?? 'Golfer'}</td>
                      {mine.map(x => <td key={x.hole} className="px-2 py-1.5 text-center"><span className="block text-xs text-muted">{x.hole}</span><span className="text-primary">{x.strokes}</span></td>)}
                      <td className="pl-3 py-1.5 font-semibold text-primary">{mine.reduce((n, x) => n + x.strokes, 0)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {mode === 'progressive' && ahead > 0 && <p className="text-xs text-muted">{hiddenNote(ahead)}</p>}

      <ConfirmModal
        isOpen={confirming}
        title="Show the full stats?"
        message="This shows the final score, every tagged play and where each one is on the video. It spoils the game, and it stays unlocked on this device."
        confirmText="Show everything"
        onCancel={() => setConfirming(false)}
        onConfirm={() => { setConfirming(false); onUnlock(); }}
      />
    </section>
  );
}
