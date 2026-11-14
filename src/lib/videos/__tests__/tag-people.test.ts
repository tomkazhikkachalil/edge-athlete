import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { narrowCandidates, orderCandidates, outsideConnections, parsePlaceholderName, PLACEHOLDER_NAME_MAX, TAG_CANDIDATES_MAX, TAG_WHO_REFUSALS, type TagCandidate } from '../tag-people';

/** Who may be tagged, and who the picker offers first (round 2, Nov 13 2026). */
const p = (id: string, name: string, handle: string | null = null) => ({ id, name, handle, avatar_url: null });

describe('a person tags connections; themself and the video\'s athlete always pass', () => {
  it('names whoever is outside', () => {
    expect(outsideConnections(['a', 'b', 'me', 'ward'], new Set(['a']), new Set(['me', 'ward']))).toEqual(['b']);
    expect(outsideConnections(['a'], new Set(['a']), new Set())).toEqual([]);
    expect(outsideConnections([], new Set(), new Set())).toEqual([]);
  });
});

describe('orderCandidates', () => {
  it('the two sides, then the organization, then connections — each person once, by name within a group', () => {
    const list = orderCandidates({
      roster: [p('3', 'Cy'), p('1', 'Ann')],
      side2: [p('2', 'Bo')],
      side1: [p('1', 'Ann'), p('4', 'Aaron')],
      connections: [p('2', 'Bo'), p('5', 'Dee')],
    });
    expect(list.map(c => [c.id, c.group])).toEqual([['4', 'side1'], ['1', 'side1'], ['2', 'side2'], ['3', 'roster'], ['5', 'connections']]);
  });
  it('is capped', () => {
    const many = Array.from({ length: TAG_CANDIDATES_MAX + 50 }, (_, i) => p(String(i), `P ${String(i).padStart(4, '0')}`));
    expect(orderCandidates({ roster: many })).toHaveLength(TAG_CANDIDATES_MAX);
  });
});

describe('narrowCandidates', () => {
  const list: TagCandidate[] = orderCandidates({ side1: [p('1', 'Ann Lee', 'annl'), p('2', 'Zoë Ánn')], side2: [p('3', 'Lee Marsh')], roster: [p('4', 'Bo Leeds')] });
  it('nothing typed lists them as ordered; the tag\'s side comes first', () => {
    expect(narrowCandidates(list, '').map(c => c.id)).toEqual(['1', '2', '3', '4']);
    expect(narrowCandidates(list, '', 2).map(c => c.id)).toEqual(['3', '1', '2', '4']);
    expect(narrowCandidates(list, '', null, 2)).toHaveLength(2);
  });
  it('every word typed starts a word of the name or the handle; accents and case do not matter', () => {
    expect(narrowCandidates(list, 'lee').map(c => c.id)).toEqual(['1', '3', '4']);
    expect(narrowCandidates(list, 'ann l').map(c => c.id)).toEqual(['1']);
    expect(narrowCandidates(list, 'ZOE').map(c => c.id)).toEqual(['2']);
    expect(narrowCandidates(list, 'annl').map(c => c.id)).toEqual(['1']);
    expect(narrowCandidates(list, 'ee')).toEqual([]);
  });
});

describe('the writer and the route', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
  const server = read('src/lib/videos/videos-server.ts');
  it('an organization tags anyone standing; a person only connections; blocks are dropped for both', () => {
    expect(server).toContain('if (ids.some(id => !here.has(id))) return { ok: false, status: 403, error: TAG_WHO_REFUSALS.gone };');
    expect(server).toContain('if (!owner.orgId) {');
    expect(server).toContain('if (outsideConnections(ids, connected, always).length > 0) return { ok: false, status: 403, error: TAG_WHO_REFUSALS.profile };');
    expect(server.indexOf('TAG_WHO_REFUSALS.profile')).toBeLessThan(server.indexOf('const { allowed } = await filterBlockedBidirectional(admin, taggerId, ids);'));
    expect(TAG_WHO_REFUSALS.profile).toContain('follow');
  });
  it('both tag routes say whose video it is', () => {
    const owner = '{ orgId: read.row.org_id ?? null, profileId: read.row.profile_id ?? null }';
    expect(read('src/app/api/videos/[id]/highlights/route.ts')).toContain(`prepareTag(admin, id, parsed.value.tag, user.id, null, ${owner})`);
    expect(read('src/app/api/videos/[id]/highlights/[highlightId]/route.ts')).toContain(`prepareTag(admin, id, parsed.value.tag, user.id, highlightId, ${owner})`);
  });
  it('the roster list is a manager\'s, private, limited, and read once by the form', () => {
    const route = read('src/app/api/videos/[id]/people/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'people-search' })");
    expect(route).toContain("if (!read.canManage) return NextResponse.json({ error: 'Only a manager can tag this video.' }, { status: 403, headers: PRIVATE });");
    expect(route).toContain("const PRIVATE = { 'Cache-Control': 'private, no-store' };");
    const reader = read('src/lib/videos/tag-people-server.ts');
    expect(reader).toContain("currentTeamRosterRows(admin, teamIds, { orgId: video.org_id })");
    expect(reader).toContain('filterBlockedBidirectional(admin, userId, all)');
    expect(reader).toContain('.filter(p => !p.departed_at)');
    const fields = read('src/components/videos/TagFields.tsx');
    expect(fields).toContain('}, [videoId]);');
    expect(fields).toContain("if (!searches) return [] as PersonSuggestion[];");
  });
});

/** A player without an account — clubs and leagues only (round 2 PR 3). */
describe('parsePlaceholderName', () => {
  it('trims, single-spaces, drops commas; first word = first name, the rest = last name', () => {
    expect(parsePlaceholderName('  Ann   Lee ')).toEqual({ ok: true, firstName: 'Ann', lastName: 'Lee', name: 'Ann Lee' });
    expect(parsePlaceholderName('Lee, Ann')).toEqual({ ok: true, firstName: 'Lee', lastName: 'Ann', name: 'Lee Ann' });
    expect(parsePlaceholderName('Pelé')).toEqual({ ok: true, firstName: 'Pelé', lastName: null, name: 'Pelé' });
    expect(parsePlaceholderName('Mary Jo van der Berg')).toMatchObject({ firstName: 'Mary', lastName: 'Jo van der Berg' });
  });
  it('nothing, not text, or too long is refused', () => {
    expect(parsePlaceholderName('  ').ok).toBe(false);
    expect(parsePlaceholderName(7).ok).toBe(false);
    expect(parsePlaceholderName('x'.repeat(PLACEHOLDER_NAME_MAX + 1)).ok).toBe(false);
  });
});

describe('the placeholder writer and route', () => {
  const read = (f: string) => readFileSync(join(process.cwd(), f), 'utf8');
  it('only a club or league, only a manager of the video AND of the roster, one stub per request under its own limit', () => {
    const route = read('src/app/api/videos/[id]/people/route.ts');
    expect(route).toContain("getServerAuth(request, { limit: 'tag-placeholder' })");
    expect(route).toContain("if (owner.kind !== 'org') return NextResponse.json({ error: PLACEHOLDER_REFUSALS.not_org }, { status: 403, headers: PRIVATE });");
    expect(route).toContain("requireOrgManager(admin, user, owner.side, owner.id, { intent: 'manage_members' })");
    expect(route.indexOf('if (!read.canManage)', route.indexOf('export async function POST'))).toBeLessThan(route.indexOf('requireOrgManager(admin'));
    expect(read('src/lib/rate-limit-core.ts')).toContain("'tag-placeholder': { max: 60, windowSeconds: 3600, keyBy: 'user' },");
  });
  it('it is the roster import\'s own stub (private, claimable) — on the side\'s team when it has a season, else the organization\'s roster', () => {
    const writer = read('src/lib/videos/tag-people-server.ts');
    expect(writer).toContain('let made = teamId ? await importRoster(admin, { ...base, teamId }) : null;');
    expect(writer).toContain('if (!made || !made.ok) made = await importRoster(admin, { ...base, teamId: null });');
    const roster = read('src/lib/orgs/roster-import.ts');
    expect(roster).toContain('teamId: string | null;');
    expect(roster).toContain("...(input.teamId ? [{ ...pairFor(input), profile_id: profileId, kind: 'roster', role: 'member', status: 'active', scope_type: 'team', scope_id: input.teamId, season_id: seasonId }] : []),");
    expect(roster).toContain("if (input.teamId && !seasonId) return { ok: false, reason: 'no_season' };");
  });
  it('the picker offers it only on an organization\'s video', () => {
    expect(read('src/components/videos/TagFields.tsx')).toContain('{searches && videoId && typed.length > 0 && (');
  });
});
