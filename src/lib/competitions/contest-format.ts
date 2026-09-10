// ── Contest page formatting — pure, client-safe (Contest Place E1) ────────
// The title, the "when" line and the status vocabulary the contest page
// renders, kept out of contest-view.ts (server) and calendar-mirror.ts
// (server) so the client gate island and the org-site twin can import
// them without dragging a Supabase client into a browser chunk.

import type { ContestView } from './contest-view';
import { formatDateRange } from './golf-weeks';

export const CONTEST_STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled',
  in_progress: 'In progress',
  completed: 'Final',
  canceled: 'Cancelled',
  postponed: 'Postponed',
};

export function contestStatusLabel(status: string): string {
  return CONTEST_STATUS_LABEL[status] ?? status;
}

/** "Blazers vs Comets" for a fixture; "Week 3" / "Round" for the rest. */
export function contestHeadline(view: ContestView): string {
  const o = view.outcome;
  if (o.kind === 'fixture' && o.home && o.away) return `${o.home.name} vs ${o.away.name}`;
  return view.contest.round?.trim() || 'Round';
}

/** The document title: "Blazers vs Comets — House League". */
export function contestTitle(view: ContestView): string {
  return `${contestHeadline(view)} — ${view.competition.name}`.slice(0, 120);
}

/** "Play any day Sep 15 – 21 · 9 holes" for a window; the scheduled
 *  time in the mirror event's zone otherwise; honest when neither. */
export function contestWhen(view: ContestView): string {
  const c = view.contest;
  if (c.playFrom && c.playTo) {
    return [`Play any day ${formatDateRange(c.playFrom, c.playTo)}`, c.holes ? `${c.holes} holes` : null]
      .filter(Boolean)
      .join(' · ');
  }
  if (c.scheduledAt) {
    const date = new Date(c.scheduledAt);
    if (!Number.isNaN(date.getTime())) {
      try {
        return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: c.timezone }).format(date);
      } catch {
        return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(date) + ' UTC';
      }
    }
  }
  return 'Time to be announced';
}

/** "Kanata Rink · Rink 2" / "QA Nine" — the place line, or null. */
export function contestWhere(view: ContestView): string | null {
  const c = view.contest;
  const parts = [c.courseName ?? c.venueName, c.facilityName].filter((v): v is string => !!v);
  return parts.length ? parts.join(' · ') : null;
}

export const PROVENANCE_LABEL: Record<string, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  self_reported: 'Self-reported',
  imported: 'Imported',
};
