// ── Schedule + historical results import (phase 6 R6) ───────────────────────
// Rows `date, time, home, away` (+ optional venue, home_score,
// away_score) mint CONTESTS inside ONE chosen competition — contests,
// not bare calendar events, because the calendar mirror derives events
// from contests (calendar comes free) and contest rows are
// standings-eligible. Team names resolve against the competition's
// ENTRIES (unmatched = row error; the dry-run shows the resolution);
// venue resolves by name (unmatched = warning, never an error). Scores
// present → the contest lands 'completed' and two contest_results rows
// carry provenance 'imported' — the reserved rung's FIRST writer
// (masterplan §10: historical data visibly labeled; deriveDisplayTier
// never upgrades it, correct by design).
//
// Dedupe key (competition, scheduled_at, home entry, away entry): a
// re-paste reports 'reuse'. Dry-run-first, per-row best-effort, cap 200
// (csv.ts). Wall times convert through the caller's IANA zone via the
// calendar's zonedWallClockToUtc (the publish-to-calendar precedent).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCsv, checkHeaders } from './csv';
import { zonedWallClockToUtc } from '@/lib/calendar/recurrence';
import { recomputeStandingsBestEffort } from '@/lib/competitions/standings';
import { revalidateOrgSiteForCompetition } from '@/lib/org-sites/revalidate';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[SCHEDULE-IMPORT]';

const REQUIRED = ['date', 'time', 'home', 'away'];
const OPTIONAL = ['venue', 'home_score', 'away_score'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

export interface ScheduleRowReport {
  row: number;
  matchup: string;
  scheduledAt: string | null;
  action: 'create' | 'reuse' | 'error' | 'dry-create' | 'dry-reuse';
  withResult: boolean;
  warning?: string;
  error?: string;
}

export async function scheduleImportPOST(
  admin: Admin,
  competition: { id: string; format: string; status: string },
  enteredBy: string,
  input: { csv: string; timezone: string; dryRun: boolean }
): Promise<NextResponse> {
  if (competition.format !== 'fixture') {
    return NextResponse.json(
      { error: 'Schedule import works on fixture competitions (home/away games)' },
      { status: 400 }
    );
  }

  const parsed = parseCsv(input.csv);
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }
  const headerProblem = checkHeaders(parsed.headers, REQUIRED, OPTIONAL);
  if (headerProblem) return NextResponse.json({ error: headerProblem }, { status: 400 });

  // The resolution tables: entries by team name, venues by name, and
  // the existing contests for the dedupe key.
  const { data: entries } = await admin
    .from('competition_entries')
    .select('id, team_id')
    .eq('competition_id', competition.id)
    .limit(500);
  const teamIds = [...new Set((entries ?? []).map(e => e.team_id).filter(Boolean))] as string[];
  const { data: teams } = teamIds.length
    ? await admin.from('teams').select('id, name, display_name').in('id', teamIds)
    : { data: [] };
  const entryByTeamName = new Map<string, string>();
  for (const e of entries ?? []) {
    const team = (teams ?? []).find(t => t.id === e.team_id);
    if (!team) continue;
    entryByTeamName.set((team.name as string).toLowerCase(), e.id as string);
    if (team.display_name) {
      entryByTeamName.set((team.display_name as string).toLowerCase(), e.id as string);
    }
  }

  const venueNames = [
    ...new Set(parsed.rows.map(r => (r.venue ?? '').trim().toLowerCase()).filter(Boolean)),
  ];
  const venueByName = new Map<string, string>();
  if (venueNames.length) {
    const { data: venues } = await admin.from('venues').select('id, name').limit(500);
    for (const v of venues ?? []) {
      const key = (v.name as string).toLowerCase();
      if (venueNames.includes(key)) venueByName.set(key, v.id as string);
    }
  }

  const dedupe = new Set<string>();
  {
    const { data: existing } = await admin
      .from('contests')
      .select('id, scheduled_at')
      .eq('competition_id', competition.id)
      .limit(1000);
    const existingIds = (existing ?? []).map(c => c.id as string);
    const { data: parts } = existingIds.length
      ? await admin
          .from('contest_participants')
          .select('contest_id, entry_id, side')
          .in('contest_id', existingIds)
          .limit(2000)
      : { data: [] };
    const byContest = new Map<string, { home?: string; away?: string }>();
    for (const p of parts ?? []) {
      const rec = byContest.get(p.contest_id as string) ?? {};
      if (p.side === 'home') rec.home = p.entry_id as string;
      if (p.side === 'away') rec.away = p.entry_id as string;
      byContest.set(p.contest_id as string, rec);
    }
    for (const c of existing ?? []) {
      const rec = byContest.get(c.id as string);
      if (rec?.home && rec.away && c.scheduled_at) {
        dedupe.add(`${new Date(c.scheduled_at as string).toISOString()}:${rec.home}:${rec.away}`);
      }
    }
  }

  const report: ScheduleRowReport[] = [];
  let createdWithResults = 0;
  for (let idx = 0; idx < parsed.rows.length; idx++) {
    const raw = parsed.rows[idx];
    const entry: ScheduleRowReport = {
      row: idx + 1,
      matchup: `${raw.home || '?'} vs ${raw.away || '?'}`,
      scheduledAt: null,
      action: 'error',
      withResult: false,
    };
    report.push(entry);

    if (!DATE_RE.test(raw.date) || !TIME_RE.test(raw.time)) {
      entry.error = 'date must be YYYY-MM-DD and time HH:MM (24h)';
      continue;
    }
    const [y, m, d] = raw.date.split('-').map(Number);
    const [hh, mm] = raw.time.split(':').map(Number);
    const scheduledMs = zonedWallClockToUtc(y, m, d, hh, mm, input.timezone);
    const scheduledIso = new Date(scheduledMs).toISOString();
    entry.scheduledAt = scheduledIso;

    const homeEntry = entryByTeamName.get((raw.home ?? '').toLowerCase());
    const awayEntry = entryByTeamName.get((raw.away ?? '').toLowerCase());
    if (!homeEntry || !awayEntry) {
      entry.error = `${!homeEntry ? `"${raw.home}"` : `"${raw.away}"`} is not entered in this competition — add the team first`;
      continue;
    }
    if (homeEntry === awayEntry) {
      entry.error = 'home and away are the same team';
      continue;
    }

    const hasScores = raw.home_score !== undefined && raw.home_score !== '' && raw.away_score !== undefined && raw.away_score !== '';
    const homeScore = hasScores ? Number(raw.home_score) : null;
    const awayScore = hasScores ? Number(raw.away_score) : null;
    if (hasScores && (!Number.isFinite(homeScore) || !Number.isFinite(awayScore))) {
      entry.error = 'scores must be numbers (or both blank for an unplayed game)';
      continue;
    }
    entry.withResult = hasScores;

    const venueKey = (raw.venue ?? '').trim().toLowerCase();
    const venueId = venueKey ? (venueByName.get(venueKey) ?? null) : null;
    if (venueKey && !venueId) {
      entry.warning = `venue "${raw.venue}" not found — game imported without one`;
    }

    const key = `${scheduledIso}:${homeEntry}:${awayEntry}`;
    if (dedupe.has(key)) {
      entry.action = input.dryRun ? 'dry-reuse' : 'reuse';
      continue;
    }
    if (input.dryRun) {
      entry.action = 'dry-create';
      dedupe.add(key);
      continue;
    }

    const { data: contest, error: contestError } = await admin
      .from('contests')
      .insert({
        competition_id: competition.id,
        scheduled_at: scheduledIso,
        status: hasScores ? 'completed' : 'scheduled',
        venue_id: venueId,
      })
      .select('id')
      .single();
    if (contestError || !contest) {
      console.error(`${TAG} contest insert error:`, contestError);
      entry.error = 'Failed to create the game';
      continue;
    }
    const { data: partRows, error: partError } = await admin
      .from('contest_participants')
      .insert([
        { contest_id: contest.id, entry_id: homeEntry, side: 'home' },
        { contest_id: contest.id, entry_id: awayEntry, side: 'away' },
      ])
      .select('id, side');
    if (partError || !partRows || partRows.length !== 2) {
      console.error(`${TAG} participants insert error:`, partError);
      // Compensate — a contest without participants is noise.
      await admin.from('contests').delete().eq('id', contest.id);
      entry.error = 'Failed to add the teams to the game';
      continue;
    }
    if (hasScores) {
      const homePart = partRows.find(p => p.side === 'home')!;
      const awayPart = partRows.find(p => p.side === 'away')!;
      const { error: resultError } = await admin.from('contest_results').insert([
        {
          contest_id: contest.id,
          participant_id: homePart.id,
          score: homeScore,
          payload: {},
          provenance: 'imported',
          entered_by: enteredBy,
        },
        {
          contest_id: contest.id,
          participant_id: awayPart.id,
          score: awayScore,
          payload: {},
          provenance: 'imported',
          entered_by: enteredBy,
        },
      ]);
      if (resultError) {
        console.error(`${TAG} results insert error:`, resultError);
        await admin.from('contests').delete().eq('id', contest.id);
        entry.error = 'Failed to record the imported result';
        continue;
      }
      createdWithResults++;
    }
    entry.action = 'create';
    dedupe.add(key);
  }

  if (!input.dryRun) {
    if (createdWithResults > 0) {
      await recomputeStandingsBestEffort(admin, competition.id);
    }
    await revalidateOrgSiteForCompetition(admin, competition.id);
  }

  return NextResponse.json({
    dryRun: input.dryRun,
    report,
    summary: {
      rows: report.length,
      errors: report.filter(r => r.error).length,
      warnings: report.filter(r => r.warning).length,
      created: report.filter(r => r.action === 'create' || r.action === 'dry-create').length,
      reused: report.filter(r => r.action === 'reuse' || r.action === 'dry-reuse').length,
      withResults: report.filter(r => (r.action === 'create' || r.action === 'dry-create') && r.withResult).length,
    },
  });
}
