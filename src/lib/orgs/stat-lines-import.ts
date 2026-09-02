// ── Per-athlete stat-line CSV import (phase 6c I2) ───────────────────────────
// The last §10 importer. Rows `date, home, away, team, player` plus the
// sport's stat keys as columns (`goals, assists, …` — exactly the
// STAT_SCHEMAS vocabulary, so one language for typed, self-posted and
// imported stats). Each row resolves to ONE contest (the game on that
// date between those teams, dates read in the manager's zone), ONE side
// (the team named), and ONE roster athlete (matchRosterName: exact after
// normalization, unique or a row error — never a guess). The write goes
// through statLinesUpsertPOST with provenance 'imported', so THE
// ATTRIBUTION GATE (active team roster or nothing) runs unchanged.
//
// Owner authority only: an import is the organizer's act; participating
// club staff keep the per-game panel. Dry-run is the default; per-row
// best-effort; the report shape mirrors the schedule importer's.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseCsv, checkHeaders } from './csv';
import { matchRosterName, type RosterName } from './roster-match';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { wallClockInZone } from '@/lib/calendar/recurrence';
import {
  resolveCompetitionAccess,
  rosterByTeam,
  statLinesUpsertPOST,
  type CompRow,
} from './stat-lines-server';
import type { CompetitionScope } from './competition-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias
type Admin = SupabaseClient<any, 'public', any>;

const REQUIRED = ['date', 'home', 'away', 'team', 'player'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export interface StatLineRowReport {
  row: number;
  date: string;
  matchup: string;
  player: string;
  action: 'import' | 'dry-import' | 'error';
  stats?: Record<string, number>;
  error?: string;
}

export async function statLinesImportPOST(
  admin: Admin,
  competition: CompRow,
  scope: CompetitionScope | null,
  enteredBy: string,
  input: { csv: string; timezone: string; dryRun: boolean }
): Promise<NextResponse> {
  const access = await resolveCompetitionAccess(admin, competition, scope);
  if (!access) return NextResponse.json({ error: 'Competition not found' }, { status: 404 });
  if (access.authority !== 'owner') {
    return NextResponse.json(
      { error: 'Only the competition owner can import player stats' },
      { status: 403 }
    );
  }
  if (competition.format !== 'fixture') {
    return NextResponse.json({ error: 'Player stats apply to team competitions' }, { status: 400 });
  }
  const schema = getStatSchema(competition.sport_key);
  if (!schema) {
    return NextResponse.json({ error: 'Player stats aren’t available for this sport' }, { status: 400 });
  }

  const parsed = parseCsv(input.csv);
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }
  const statKeys = schema.fields.map(f => f.key);
  const headerProblem = checkHeaders(parsed.headers, REQUIRED, statKeys);
  if (headerProblem) return NextResponse.json({ error: headerProblem }, { status: 400 });
  const presentStatKeys = statKeys.filter(k => parsed.headers.includes(k));
  if (presentStatKeys.length === 0) {
    return NextResponse.json(
      { error: `Add at least one stat column: ${statKeys.join(', ')}` },
      { status: 400 }
    );
  }

  // The competition's contests, keyed (date in the manager's zone, home, away).
  const { data: contests } = await admin
    .from('contests')
    .select('id, scheduled_at, status')
    .eq('competition_id', competition.id)
    .neq('status', 'canceled')
    .limit(1000);
  const contestIds = (contests ?? []).map(c => c.id as string);
  const { data: parts } = contestIds.length
    ? await admin
        .from('contest_participants')
        .select('contest_id, side, entry:entry_id (team_id)')
        .in('contest_id', contestIds)
        .limit(2000)
    : { data: [] };
  const teamIds = new Set<string>();
  const sidesByContest = new Map<string, { home?: string; away?: string }>();
  for (const p of parts ?? []) {
    const entry = Array.isArray(p.entry) ? p.entry[0] : p.entry;
    const teamId = entry?.team_id as string | undefined;
    if (!teamId) continue;
    teamIds.add(teamId);
    const rec = sidesByContest.get(p.contest_id as string) ?? {};
    if (p.side === 'home') rec.home = teamId;
    if (p.side === 'away') rec.away = teamId;
    sidesByContest.set(p.contest_id as string, rec);
  }
  const { data: teams } = teamIds.size
    ? await admin.from('teams').select('id, name, display_name').in('id', [...teamIds])
    : { data: [] };
  const teamNameById = new Map((teams ?? []).map(t => [t.id as string, (t.display_name || t.name) as string]));
  const teamIdByName = new Map<string, string>();
  for (const t of teams ?? []) {
    teamIdByName.set((t.name as string).toLowerCase(), t.id as string);
    if (t.display_name) teamIdByName.set((t.display_name as string).toLowerCase(), t.id as string);
  }
  const pad = (n: number) => String(n).padStart(2, '0');
  const contestByKey = new Map<string, string>();
  for (const c of contests ?? []) {
    const sides = sidesByContest.get(c.id as string);
    if (!sides?.home || !sides.away || !c.scheduled_at) continue;
    const w = wallClockInZone(new Date(c.scheduled_at as string).getTime(), input.timezone);
    contestByKey.set(`${w.y}-${pad(w.m)}-${pad(w.d)}|${sides.home}|${sides.away}`, c.id as string);
  }

  // Rosters with display names for the matcher.
  const roster = await rosterByTeam(admin, [...teamIds]);
  const profileIds = [...new Set([...roster.values()].flatMap(set => [...set]))];
  const { data: profiles } = profileIds.length
    ? await admin.from('profiles').select('id, first_name, last_name, full_name').in('id', profileIds)
    : { data: [] };
  const nameById = new Map(
    (profiles ?? []).map(p => [
      p.id as string,
      ((p.full_name as string | null) || `${p.first_name ?? ''} ${p.last_name ?? ''}`.trim() || 'Athlete') as string,
    ])
  );
  const rosterNames = (teamId: string): RosterName[] =>
    [...(roster.get(teamId) ?? [])].map(profileId => ({ profileId, displayName: nameById.get(profileId) ?? 'Athlete' }));

  const fieldByKey = new Map(schema.fields.map(f => [f.key, f]));
  const report: StatLineRowReport[] = [];
  const linesByContest = new Map<string, { profileId: string; teamId: string; stats: Record<string, number>; reportIndex: number }[]>();

  for (let idx = 0; idx < parsed.rows.length; idx++) {
    const raw = parsed.rows[idx];
    const entry: StatLineRowReport = {
      row: idx + 1,
      date: raw.date ?? '',
      matchup: `${raw.home || '?'} vs ${raw.away || '?'}`,
      player: raw.player ?? '',
      action: 'error',
    };
    report.push(entry);
    if (!DATE_RE.test(raw.date ?? '')) {
      entry.error = 'date must be YYYY-MM-DD';
      continue;
    }
    const homeId = teamIdByName.get((raw.home ?? '').toLowerCase());
    const awayId = teamIdByName.get((raw.away ?? '').toLowerCase());
    if (!homeId || !awayId) {
      entry.error = `${!homeId ? `"${raw.home}"` : `"${raw.away}"`} is not a team in this competition`;
      continue;
    }
    const contestId = contestByKey.get(`${raw.date}|${homeId}|${awayId}`);
    if (!contestId) {
      entry.error = 'no game between those teams on that date — import the schedule first';
      continue;
    }
    const teamId = teamIdByName.get((raw.team ?? '').toLowerCase());
    if (!teamId || (teamId !== homeId && teamId !== awayId)) {
      entry.error = `"${raw.team}" is not one of the two teams in that game`;
      continue;
    }
    const match = matchRosterName(raw.player ?? '', rosterNames(teamId));
    if (!match.ok) {
      entry.error =
        match.error === 'ambiguous'
          ? `"${raw.player}" matches more than one player on ${teamNameById.get(teamId)} (${match.candidates?.join(', ')})`
          : `"${raw.player}" is not on ${teamNameById.get(teamId)}'s roster`;
      continue;
    }
    const stats: Record<string, number> = {};
    let bad: string | null = null;
    for (const key of presentStatKeys) {
      const v = (raw[key] ?? '').trim();
      if (v === '') continue;
      const n = Number(v);
      const field = fieldByKey.get(key)!;
      if (!Number.isFinite(n)) {
        bad = `${field.label} must be a number`;
        break;
      }
      if ((field.min !== undefined && n < field.min) || (field.max !== undefined && n > field.max)) {
        bad = `${field.label} is out of range`;
        break;
      }
      stats[key] = n;
    }
    if (bad) {
      entry.error = bad;
      continue;
    }
    if (Object.keys(stats).length === 0) {
      entry.error = 'no stats on this row';
      continue;
    }
    entry.player = match.displayName;
    entry.stats = stats;
    entry.action = input.dryRun ? 'dry-import' : 'import';
    if (!linesByContest.has(contestId)) linesByContest.set(contestId, []);
    linesByContest.get(contestId)!.push({ profileId: match.profileId, teamId, stats, reportIndex: idx });
  }

  if (!input.dryRun) {
    for (const [contestId, lines] of linesByContest) {
      // One upsert per contest (the panel's own batch shape); a later row
      // for the same player in the same game wins, like the panel.
      const byProfile = new Map(lines.map(l => [l.profileId, l]));
      const res = await statLinesUpsertPOST(
        admin,
        { contestId, lines: [...byProfile.values()].map(l => ({ profileId: l.profileId, teamId: l.teamId, stats: l.stats })) },
        scope,
        enteredBy,
        { provenance: 'imported' }
      );
      if (res.status !== 200) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        for (const l of lines) {
          report[l.reportIndex].action = 'error';
          report[l.reportIndex].error = body.error ?? 'Failed to save the stats';
        }
      }
    }
  }

  return NextResponse.json({
    dryRun: input.dryRun,
    report,
    summary: {
      rows: report.length,
      errors: report.filter(r => r.error).length,
      imported: report.filter(r => r.action === 'import' || r.action === 'dry-import').length,
      games: linesByContest.size,
    },
  });
}
