import type { PublicGolfRound } from '@/lib/org-sites/public-data';
import { formatDateRange, formatIsoDate } from '@/lib/competitions/golf-weeks';

// A golf league's season on the schedule (phase 6e S4): its play windows
// — open / upcoming as rows with a state chip, closed ones collapsed in
// a native <details>. Props-only, server-safe (no hooks, no icon font).

function Chip({ state }: { state: PublicGolfRound['state'] }) {
  if (state === 'open') {
    return (
      <span className="inline-block rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700">
        open now
      </span>
    );
  }
  if (state === 'upcoming') {
    return (
      <span className="inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-secondary">
        upcoming
      </span>
    );
  }
  return (
    <span className="inline-block rounded-full bg-surface-sunken px-2 py-0.5 text-[11px] font-medium text-muted">
      closed
    </span>
  );
}

function Row({ r, showCompetition }: { r: PublicGolfRound; showCompetition: boolean }) {
  return (
    <li className="py-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
      <div className="min-w-0">
        <p className="text-sm font-medium text-primary">
          {r.round ?? 'Round'}
          {showCompetition ? <span className="font-normal text-muted">{` · ${r.competitionName}`}</span> : null}
        </p>
        <p className="text-xs text-tertiary">
          {[formatDateRange(r.playFrom, r.playTo), r.holes ? `${r.holes} holes` : null, r.courseName]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>
      <Chip state={r.state} />
    </li>
  );
}

export default function GolfRoundsSchedule({ rounds, compact }: { rounds: PublicGolfRound[]; compact?: boolean }) {
  if (rounds.length === 0) return null;
  const competitions = new Set(rounds.map(r => r.competitionId));
  const showCompetition = competitions.size > 1;
  const live = rounds.filter(r => r.state !== 'closed');
  const closed = rounds.filter(r => r.state === 'closed');
  const shown = compact ? live.slice(0, 3) : live;
  return (
    <div aria-label="League rounds">
      {shown.length > 0 ? (
        <ul className="mt-2 divide-y divide-border-subtle">
          {shown.map(r => (
            <Row key={r.id} r={r} showCompetition={showCompetition} />
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-tertiary">
          {closed.length > 0 ? `The season's last round closed ${formatIsoDate(closed[closed.length - 1].playTo)}.` : ''}
        </p>
      )}
      {!compact && closed.length > 0 && (
        <details className="mt-2 rounded-lg border border-border-subtle px-3 py-2">
          <summary className="cursor-pointer text-sm text-secondary">
            {`${closed.length} closed ${closed.length === 1 ? 'round' : 'rounds'}`}
          </summary>
          <ul className="divide-y divide-border-subtle">
            {[...closed].reverse().map(r => (
              <Row key={r.id} r={r} showCompetition={showCompetition} />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
