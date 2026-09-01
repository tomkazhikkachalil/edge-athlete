// ── Structure import (phase 6 R5) — divisions + teams + entries by CSV ──────
// Masterplan §10: "getting an association off their existing site is the
// actual sales obstacle." Rows `division, team_name` (+ optional
// age_band, gender_stream, tier, sport) land against ONE target season:
// division upsert on divisions_season_name_uniq, team reuse on
// teams_org_name_uniq, entry insert-if-absent on team_entries_uniq — so
// a re-paste is a no-op report, idempotent BY CONSTRAINT, not by hope.
//
// Dry-run-first (the storage-sweep precedent): dryRun computes the same
// per-row plan and writes nothing; the real run returns the identical
// report shape (the roster-import per-row best-effort rule — one bad row
// never aborts the batch). Cap 200 rows (csv.ts enforces).

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import { parseCsv, checkHeaders } from './csv';
import { seasonArchivedMap } from './rollover-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[STRUCTURE-IMPORT]';

export interface ImportRowReport {
  row: number; // 1-based data-row number (header excluded)
  division: string;
  team: string;
  divisionAction: 'create' | 'reuse' | 'error' | 'dry-create' | 'dry-reuse';
  teamAction: 'create' | 'reuse' | 'error' | 'dry-create' | 'dry-reuse';
  entryAction: 'create' | 'reuse' | 'error' | 'dry-create' | 'dry-reuse' | 'skipped';
  error?: string;
}

const REQUIRED = ['division', 'team_name'];
const OPTIONAL = ['age_band', 'gender_stream', 'tier', 'sport'];

export async function structureImportPOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  orgSportKey: string | null,
  input: { seasonId: string; csv: string; dryRun: boolean }
): Promise<NextResponse> {
  const col = side === 'league' ? 'league_id' : 'club_id';

  const { data: season } = await admin
    .from('seasons')
    .select('id, label')
    .eq('id', input.seasonId)
    .eq(col, orgId)
    .maybeSingle();
  if (!season) return NextResponse.json({ error: 'Season not found' }, { status: 404 });
  const archived = await seasonArchivedMap(admin, [input.seasonId]);
  if (archived.get(input.seasonId)) {
    return NextResponse.json(
      { error: 'That season is archived — roll it forward first' },
      { status: 400 }
    );
  }

  const parsed = parseCsv(input.csv);
  if (parsed.errors.length > 0) {
    return NextResponse.json({ error: parsed.errors.join('; ') }, { status: 400 });
  }
  const headerProblem = checkHeaders(parsed.headers, REQUIRED, OPTIONAL);
  if (headerProblem) return NextResponse.json({ error: headerProblem }, { status: 400 });

  // Preload the existing landscape once (the dry-run answers from it).
  const [{ data: existingDivisions }, { data: existingTeams }] = await Promise.all([
    admin.from('divisions').select('id, name').eq('season_id', input.seasonId).limit(300),
    admin.from('teams').select('id, name').eq(col, orgId).limit(500),
  ]);
  const divisionByName = new Map(
    (existingDivisions ?? []).map(d => [(d.name as string).toLowerCase(), d.id as string])
  );
  const teamByName = new Map(
    (existingTeams ?? []).map(t => [(t.name as string).toLowerCase(), t.id as string])
  );
  const entryKeys = new Set<string>();
  {
    const divisionIds = [...divisionByName.values()];
    if (divisionIds.length) {
      const { data: entries } = await admin
        .from('team_entries')
        .select('team_id, division_id')
        .in('division_id', divisionIds)
        .limit(1000);
      for (const e of entries ?? []) entryKeys.add(`${e.team_id}:${e.division_id}`);
    }
  }

  const report: ImportRowReport[] = [];
  // In-file dedupe carries forward within the run (two rows minting the
  // same division create it once, the second reuses).
  for (let idx = 0; idx < parsed.rows.length; idx++) {
    const raw = parsed.rows[idx];
    const rowNum = idx + 1;
    const divisionName = raw.division;
    const teamName = raw.team_name;
    const entry: ImportRowReport = {
      row: rowNum,
      division: divisionName,
      team: teamName,
      divisionAction: 'error',
      teamAction: 'error',
      entryAction: 'skipped',
    };
    report.push(entry);
    if (!divisionName || !teamName) {
      entry.error = 'division and team_name are both required';
      continue;
    }

    // ── Division ──
    let divisionId = divisionByName.get(divisionName.toLowerCase()) ?? null;
    if (divisionId) {
      entry.divisionAction = input.dryRun ? 'dry-reuse' : 'reuse';
    } else if (input.dryRun) {
      entry.divisionAction = 'dry-create';
      divisionId = `dry:${divisionName.toLowerCase()}`;
      divisionByName.set(divisionName.toLowerCase(), divisionId);
    } else {
      const { data: created, error } = await admin
        .from('divisions')
        .upsert(
          {
            [col]: orgId,
            season_id: input.seasonId,
            sport_key: raw.sport || orgSportKey || 'training',
            name: divisionName,
            age_band: raw.age_band || null,
            gender_stream: raw.gender_stream || null,
            tier: raw.tier || null,
          },
          { onConflict: 'season_id,name' }
        )
        .select('id')
        .single();
      if (error || !created) {
        console.error(`${TAG} division upsert error:`, error);
        entry.error = 'Failed to create the division';
        continue;
      }
      divisionId = created.id as string;
      entry.divisionAction = 'create';
      divisionByName.set(divisionName.toLowerCase(), divisionId);
    }

    // ── Team ──
    let teamId = teamByName.get(teamName.toLowerCase()) ?? null;
    if (teamId) {
      entry.teamAction = input.dryRun ? 'dry-reuse' : 'reuse';
    } else if (input.dryRun) {
      entry.teamAction = 'dry-create';
      teamId = `dry:${teamName.toLowerCase()}`;
      teamByName.set(teamName.toLowerCase(), teamId);
    } else {
      const { data: createdTeam, error } = await admin
        .from('teams')
        // teams_org_name_uniq is NULLS NOT DISTINCT (league_id, club_id,
        // name) — the full column list works as the conflict target; the
        // absent org column stays NULL and matches.
        .upsert({ [col]: orgId, name: teamName }, { onConflict: 'league_id,club_id,name' })
        .select('id')
        .single();
      if (error || !createdTeam) {
        console.error(`${TAG} team upsert error:`, error);
        entry.error = 'Failed to create the team';
        continue;
      }
      teamId = createdTeam.id as string;
      entry.teamAction = 'create';
      teamByName.set(teamName.toLowerCase(), teamId);
    }

    // ── Entry ──
    const key = `${teamId}:${divisionId}`;
    if (entryKeys.has(key)) {
      entry.entryAction = input.dryRun ? 'dry-reuse' : 'reuse';
    } else if (input.dryRun) {
      entry.entryAction = 'dry-create';
      entryKeys.add(key);
    } else {
      const { error } = await admin
        .from('team_entries')
        .upsert(
          { team_id: teamId, division_id: divisionId },
          { onConflict: 'team_id,division_id', ignoreDuplicates: true }
        );
      if (error) {
        console.error(`${TAG} entry upsert error:`, error);
        entry.entryAction = 'error';
        entry.error = 'Failed to enter the team into the division';
        continue;
      }
      entry.entryAction = 'create';
      entryKeys.add(key);
    }
  }

  return NextResponse.json({
    dryRun: input.dryRun,
    seasonLabel: season.label,
    report,
    summary: {
      rows: report.length,
      errors: report.filter(r => r.error).length,
      divisionsCreated: report.filter(r => r.divisionAction === 'create' || r.divisionAction === 'dry-create').length,
      teamsCreated: report.filter(r => r.teamAction === 'create' || r.teamAction === 'dry-create').length,
      entriesCreated: report.filter(r => r.entryAction === 'create' || r.entryAction === 'dry-create').length,
    },
  });
}
