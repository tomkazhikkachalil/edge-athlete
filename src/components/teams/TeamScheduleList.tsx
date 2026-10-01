import type { TeamScheduleItem } from '@/lib/teams/schedule';
import { formatEventWhen } from '@/lib/org-sites/format';

// ── A team's schedule / results list (teams & divisions program, PR 7) ──────
// SERVER-SAFE on purpose (no hooks, no next/headers): the public team page
// (ISR) and the in-app team page (PR 8) render the same list. Times read in
// the item's own zone with the zone name — one render serves everyone (the
// public schedule rule, org-sites/format.ts). A result reads from the team's
// side: "W 3–2".

export function whenOf(item: TeamScheduleItem): string {
  if (!item.when) return 'Date to be set';
  const startsAt = item.when.length === 10 ? `${item.when}T12:00:00Z` : item.when;
  return formatEventWhen({ starts_at: startsAt, all_day: item.allDay, timezone: item.when.length === 10 ? 'UTC' : item.timezone });
}

const RESULT_CLASS: Record<'W' | 'L' | 'T', string> = {
  W: 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
  L: 'bg-surface-muted text-secondary border-border',
  T: 'bg-surface-muted text-secondary border-border',
};

function Row({ item }: { item: TeamScheduleItem }) {
  const title = (
    <>
      <span className="font-medium text-primary">{item.title}</span>
      {item.opponent && <span className="text-secondary">{` · vs ${item.opponent}`}</span>}
    </>
  );
  return (
    <li className="flex items-start gap-3 py-2 border-t border-border-subtle first:border-t-0" data-team-schedule-item={item.kind}>
      {item.result ? (
        <span className={`shrink-0 min-w-[4.5rem] rounded-md border px-2 py-1 text-center text-xs font-semibold ${RESULT_CLASS[item.result.outcome]}`} data-team-result={item.result.outcome}>
          {`${item.result.outcome} ${item.result.score}`}
        </span>
      ) : item.state === 'live' ? (
        <span className="shrink-0 min-w-[4.5rem] rounded-md border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/40 px-2 py-1 text-center text-xs font-semibold text-red-700 dark:text-red-300">Live</span>
      ) : null}
      <div className="min-w-0 text-sm">
        <p className="break-words">
          {item.href ? (
            <a href={item.href} className="hover:underline">
              {title}
            </a>
          ) : (
            title
          )}
        </p>
        <p className="text-xs text-secondary">
          {`${whenOf(item)}${item.location ? ` · ${item.location}` : ''}`}
        </p>
      </div>
    </li>
  );
}

export default function TeamScheduleList({ items, empty }: { items: TeamScheduleItem[]; empty: string }) {
  if (items.length === 0) return <p className="mt-1 text-sm text-tertiary">{empty}</p>;
  return (
    <ul className="mt-2">
      {items.map(item => (
        <Row key={item.key} item={item} />
      ))}
    </ul>
  );
}
