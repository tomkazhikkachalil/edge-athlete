import type { SeasonSummary } from '@/lib/competitions/golf-season-wrap';
import { playerHref } from '@/lib/org-sites/player-links';

// The season wrap (phase 8 P6) — "Season complete": champion, runner-up,
// most wins, best round. Props-only and server-safe (it renders inside
// the (public) segment): no hooks, no Font Awesome, no dark: variants.

function Name({ name, handle, basePath }: { name: string; handle?: string; basePath?: string }) {
  return handle ? (
    <a href={playerHref(handle, basePath)} className="hover:underline">
      {name}
    </a>
  ) : (
    <>{name}</>
  );
}

export default function SeasonSummaryCard({ summary, basePath }: { summary: SeasonSummary; basePath?: string }) {
  return (
    <div className="mt-3 rounded-lg border border-border-subtle bg-surface-sunken p-3 sm:p-4" data-season-complete="1">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">Season complete</p>
      <p className="mt-1 text-base font-semibold text-primary">
        <Name name={summary.champion.name} handle={summary.champion.playerHandle} basePath={basePath} />
        {summary.champion.points !== null ? ` wins with ${summary.champion.points} pts` : ' wins the season'}
        <span className="font-normal text-muted">{` · ${summary.weeksPlayed} week${summary.weeksPlayed === 1 ? '' : 's'}`}</span>
      </p>
      <dl className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-x-4 gap-y-1 text-sm">
        {summary.runnerUp && (
          <div>
            <dt className="text-xs text-muted">Runner-up</dt>
            <dd className="text-primary">
              <Name name={summary.runnerUp.name} handle={summary.runnerUp.playerHandle} basePath={basePath} />
              {summary.runnerUp.points !== null ? <span className="text-muted">{` · ${summary.runnerUp.points} pts`}</span> : null}
            </dd>
          </div>
        )}
        {summary.mostWins && (
          <div>
            <dt className="text-xs text-muted">Most wins</dt>
            <dd className="text-primary">
              <Name name={summary.mostWins.name} handle={summary.mostWins.playerHandle} basePath={basePath} />
              <span className="text-muted">{` · ${summary.mostWins.wins}`}</span>
            </dd>
          </div>
        )}
        {summary.bestRound && (
          <div>
            <dt className="text-xs text-muted">Best round</dt>
            <dd className="text-primary">
              <Name name={summary.bestRound.name} handle={summary.bestRound.playerHandle} basePath={basePath} />
              <span className="text-muted">{` · ${summary.bestRound.gross}${summary.bestRound.round ? ` in ${summary.bestRound.round}` : ''}`}</span>
            </dd>
          </div>
        )}
      </dl>
    </div>
  );
}
