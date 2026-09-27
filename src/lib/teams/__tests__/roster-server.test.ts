import { describe, expect, it } from 'vitest';
import { addToTeam, currentTeamRosterRows, moveBetweenTeams, removeFromTeam } from '../roster-server';

// Teams & divisions PR 4: the one writer. A minimal PostgREST double —
// every chain resolves to the table's canned rows; writes are recorded.

type Rows = Record<string, unknown>[];
interface Canned {
  teams?: Rows;
  memberships?: Rows; // reads (both the edges read and the team-roster read)
  seasons?: Rows;
  archived?: Rows; // seasons read with archived_at NOT NULL
  team_entries?: Rows;
  insertError?: { code: string } | null;
}

function fake(canned: Canned) {
  const writes: { table: string; op: string; payload?: unknown; filters: [string, unknown][] }[] = [];
  const from = (table: string) => {
    const filters: [string, unknown][] = [];
    let op = 'select';
    let payload: unknown;
    let archivedRead = false;
    const chain: Record<string, unknown> = {};
    const settle = () => {
      if (op !== 'select') {
        writes.push({ table, op, payload, filters: [...filters] });
        return { data: null, error: op === 'insert' ? (canned.insertError ?? null) : null };
      }
      if (table === 'seasons') return { data: archivedRead ? (canned.archived ?? []) : (canned.seasons ?? []), error: null };
      const rows = (canned as Record<string, Rows | undefined>)[table] ?? [];
      const eq = filters.filter(f => f[0].startsWith('eq:'));
      const filtered = rows.filter(r => eq.every(([k, v]) => !(k.slice(3) in r) || r[k.slice(3)] === v));
      return { data: filtered, error: null };
    };
    for (const m of ['select', 'in', 'order', 'limit', 'is']) chain[m] = () => chain;
    chain.eq = (k: string, v: unknown) => (filters.push([`eq:${k}`, v]), chain);
    chain.not = (k: string) => {
      if (table === 'seasons' && k === 'archived_at') archivedRead = true;
      return chain;
    };
    chain.insert = (p: unknown) => ((op = 'insert'), (payload = p), chain);
    chain.update = (p: unknown) => ((op = 'update'), (payload = p), chain);
    chain.delete = () => ((op = 'delete'), chain);
    chain.maybeSingle = async () => {
      const r = settle();
      return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
    };
    chain.then = (res: (v: unknown) => unknown) => Promise.resolve(settle()).then(res);
    return chain;
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test double
  return { admin: { from } as any, writes };
}

const ref = { side: 'club' as const, orgId: 'org-1' };
const team = { id: 'team-1', name: 'Blazers', status: 'active', org_id: 'org-1' };
const season = { id: 's-26', archived_at: null, created_at: '2026-09-01T00:00:00Z' };

describe('addToTeam', () => {
  it('a rostered member lands on the team IN the season (the row names it)', async () => {
    const { admin, writes } = fake({
      teams: [team],
      memberships: [{ role: 'member', kind: 'follow', status: 'active', season_id: null }, { role: 'member', kind: 'roster', status: 'active', season_id: null }],
      seasons: [season],
    });
    const res = await addToTeam(admin, ref, 'team-1', 'p-1');
    expect(res).toMatchObject({ ok: true, seasonId: 's-26', team: { id: 'team-1', name: 'Blazers' } });
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ table: 'memberships', op: 'insert', payload: { org_id: 'org-1', profile_id: 'p-1', kind: 'roster', status: 'active', scope_type: 'team', scope_id: 'team-1', season_id: 's-26' } });
  });

  it('a foreign / archived team is not found; nothing is written', async () => {
    const { admin, writes } = fake({ teams: [{ ...team, status: 'archived' }] });
    expect(await addToTeam(admin, ref, 'team-1', 'p-1')).toEqual({ ok: false, reason: 'team_not_found' });
    expect(writes).toHaveLength(0);
  });

  it('off the org roster → needs_org_roster; not a member → not_member; no season → no_season', async () => {
    const onlyFollow = fake({ teams: [team], memberships: [{ role: 'member', kind: 'follow', status: 'active', season_id: null }], seasons: [season] });
    expect(await addToTeam(onlyFollow.admin, ref, 'team-1', 'p-1')).toEqual({ ok: false, reason: 'needs_org_roster' });
    const stranger = fake({ teams: [team], memberships: [], seasons: [season] });
    expect(await addToTeam(stranger.admin, ref, 'team-1', 'p-1')).toEqual({ ok: false, reason: 'not_member' });
    const seasonless = fake({ teams: [team], memberships: [{ role: 'member', kind: 'follow', status: 'active', season_id: null }, { role: 'member', kind: 'roster', status: 'active', season_id: null }], seasons: [] });
    expect(await addToTeam(seasonless.admin, ref, 'team-1', 'p-1')).toEqual({ ok: false, reason: 'no_season' });
    for (const f of [onlyFollow, stranger, seasonless]) expect(f.writes).toHaveLength(0);
  });

  it('a second add answers already_on_team (23505)', async () => {
    const { admin } = fake({
      teams: [team],
      memberships: [{ role: 'member', kind: 'follow', status: 'active', season_id: null }, { role: 'member', kind: 'roster', status: 'active', season_id: null }],
      seasons: [season],
      insertError: { code: '23505' },
    });
    expect(await addToTeam(admin, ref, 'team-1', 'p-1')).toEqual({ ok: false, reason: 'already_on_team' });
  });
});

describe('the current roster', () => {
  it("last season's row is history — it leaves the read", async () => {
    const { admin } = fake({
      memberships: [
        { profile_id: 'p-now', scope_id: 'team-1', season_id: 's-26', status: 'active', joined_at: null },
        { profile_id: 'p-then', scope_id: 'team-1', season_id: 's-25', status: 'active', joined_at: null },
        { profile_id: 'p-legacy', scope_id: 'team-1', season_id: null, status: 'active', joined_at: null },
      ],
      archived: [{ id: 's-25' }],
    });
    expect((await currentTeamRosterRows(admin, ['team-1'])).map(r => r.profile_id).sort()).toEqual(['p-legacy', 'p-now']);
  });
});

describe('move and remove', () => {
  it('a move is ONE update of the current row (its season kept); remove deletes only the current row', async () => {
    const rows = [{ profile_id: 'p-1', scope_id: 'team-1', season_id: 's-26', status: 'active', joined_at: null }];
    const moved = fake({ teams: [team, { ...team, id: 'team-2', name: 'Comets' }], memberships: rows, archived: [] });
    expect(await moveBetweenTeams(moved.admin, ref, 'team-1', 'team-2', 'p-1')).toMatchObject({ ok: true, from: { name: 'Blazers' }, to: { name: 'Comets' } });
    expect(moved.writes).toEqual([expect.objectContaining({ table: 'memberships', op: 'update', payload: { scope_id: 'team-2' } })]);
    expect(moved.writes[0].filters).toContainEqual(['eq:season_id', 's-26']);

    const removed = fake({ teams: [team], memberships: rows, archived: [] });
    expect(await removeFromTeam(removed.admin, ref, 'team-1', 'p-1')).toMatchObject({ ok: true });
    expect(removed.writes).toEqual([expect.objectContaining({ table: 'memberships', op: 'delete' })]);
    expect(removed.writes[0].filters).toContainEqual(['eq:season_id', 's-26']);
  });

  it('moving someone who is not on the team → not_on_team', async () => {
    const { admin, writes } = fake({ teams: [team, { ...team, id: 'team-2' }], memberships: [], archived: [] });
    expect(await moveBetweenTeams(admin, ref, 'team-1', 'team-2', 'p-1')).toEqual({ ok: false, reason: 'not_on_team' });
    expect(writes).toHaveLength(0);
  });
});
