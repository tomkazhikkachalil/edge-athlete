'use client';

import { formatDateOnly } from '@/lib/sport-events/format';
import type { RoundSelection } from '@/lib/sport-events/tabs';

/**
 * The round switcher (Events program, phase 2): a pill strip shared by the
 * leaderboard, the scorecard, the groups and the schedule — "Overall" first
 * where the tab offers it, then one pill per non-cancelled round with its
 * short date and its state (a live dot, a check when final). Scrolls on a
 * phone, inline from `sm:`; every pill a 44px target; `aria-pressed` is the
 * selection. Renders nothing when there is only one choice (a single-round
 * event looks exactly as in phase 1). `data-round-switch` is the e2e hook.
 */
export interface SwitchRound {
  id: string;
  sequence: number;
  status: string;
  scheduled_on: string;
}

interface Props {
  rounds: SwitchRound[];
  selected: RoundSelection | null;
  onChange: (next: RoundSelection) => void;
  includeOverall?: boolean;
  label?: string;
}

function shortDate(value: string): string {
  return formatDateOnly(value).replace(/, \d{4}$/, '');
}

export default function RoundSwitcher({ rounds, selected, onChange, includeOverall = false, label = 'Round' }: Props) {
  const active = rounds.filter(r => r.status !== 'cancelled').sort((a, b) => a.sequence - b.sequence);
  if (active.length + (includeOverall ? 1 : 0) < 2) return null;
  const pill = (key: RoundSelection, text: string, ariaLabel: string, status?: string) => {
    const on = selected === key;
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        aria-label={ariaLabel}
        data-round-switch={key}
        onClick={() => onChange(key)}
        className={`shrink-0 inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-full border text-sm font-semibold transition-colors ${on ? 'bg-brand text-white border-brand' : 'bg-surface text-secondary border-border-strong hover:text-primary'}`}
      >
        {status === 'live' && <span className={`inline-block h-1.5 w-1.5 rounded-full ${on ? 'bg-white' : 'bg-red-600 ea-live-dot'}`} aria-hidden="true" />}
        {status === 'completed' && <i className="fas fa-check text-xs" aria-hidden="true"></i>}
        {text}
      </button>
    );
  };
  return (
    <div role="group" aria-label={label} className="flex gap-2 overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 pb-1" data-round-switcher="">
      {includeOverall && pill('overall', 'Overall', 'Overall')}
      {active.map(r => pill(r.id, `R${r.sequence} · ${shortDate(r.scheduled_on)}`, `Round ${r.sequence}, ${formatDateOnly(r.scheduled_on, { weekday: true })}${r.status === 'live' ? ', live' : r.status === 'completed' ? ', final' : ''}`, r.status))}
    </div>
  );
}
