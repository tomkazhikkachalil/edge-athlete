import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canAdvanceVideoStep } from '../video-steps';
import { gameBodyOf, gameDraftOf, parseGameDraft, pickSideTeam, typeSideName, withoutTeams } from '../game-draft';
import { parseGameBody, type GameView } from '../game-rules';

/** The game form's draft (round 2, Nov 13 2026): one field set for the card and the flow. */
const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const stored: GameView = { video_id: 'v', updated_at: 'now', sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'Hawks', team_id: T1 }, side2: { name: 'Owls', team_id: null }, coverage: 'full', stats_hidden: false };

describe('gameDraftOf', () => {
  it('no game yet: the video\'s sport when it has a sheet, spoiler-free, highlights only', () => {
    expect(gameDraftOf(null, 'basketball')).toEqual({ sport_key: 'basketball', played_on: '', side1: '', side2: '', side1_team_id: null, side2_team_id: null, coverage: 'highlights', stats_hidden: true });
    expect(gameDraftOf(null, 'curling').sport_key).toBe('');
    expect(gameDraftOf(null, null).sport_key).toBe('');
  });
  it('a stored game comes back whole, team links included', () => {
    expect(gameDraftOf(stored, null)).toEqual({ sport_key: 'basketball', played_on: '2026-11-01', side1: 'Hawks', side2: 'Owls', side1_team_id: T1, side2_team_id: null, coverage: 'full', stats_hidden: false });
  });
});

describe('sides', () => {
  const d = gameDraftOf(stored, null);
  it('typing keeps the team link; clearing the name clears the side and its link', () => {
    expect(typeSideName(d, 1, 'Hawks U16')).toMatchObject({ side1: 'Hawks U16', side1_team_id: T1 });
    expect(typeSideName(d, 1, '  ')).toMatchObject({ side1: '  ', side1_team_id: null });
  });
  it('picking a team names the side; the same team never sits on both; dropping the link keeps the name', () => {
    expect(pickSideTeam(d, 2, { id: T2, name: 'Owls Blue' })).toMatchObject({ side2: 'Owls Blue', side2_team_id: T2, side1_team_id: T1 });
    expect(pickSideTeam(d, 2, { id: T1, name: 'Hawks' })).toMatchObject({ side2: 'Hawks', side2_team_id: T1, side1: '', side1_team_id: null });
    expect(pickSideTeam(d, 1, null)).toMatchObject({ side1: 'Hawks', side1_team_id: null });
    expect(withoutTeams(d)).toMatchObject({ side1: 'Hawks', side1_team_id: null, side2_team_id: null });
  });
});

describe('gameBodyOf', () => {
  it('is a body the API accepts, as stored', () => {
    const parsed = parseGameBody(gameBodyOf(gameDraftOf(stored, null)), '2026-11-13');
    expect(parsed).toEqual({ ok: true, value: { sport_key: 'basketball', played_on: '2026-11-01', side1: { name: 'Hawks', team_id: T1 }, side2: { name: 'Owls', team_id: null }, coverage: 'full', stats_hidden: false } });
  });
  it('a sport without sides sends none; an empty side has no team', () => {
    expect(gameBodyOf({ ...gameDraftOf(stored, null), sport_key: 'running' })).toMatchObject({ side1: null, side2: null });
    expect(gameBodyOf({ ...gameDraftOf(stored, null), side1: ' ' }).side1).toEqual({ name: null, team_id: null });
    expect(gameBodyOf({ ...gameDraftOf(null, 'basketball') }).played_on).toBeNull();
  });
});

describe('parseGameDraft', () => {
  it('a draft round-trips through JSON; anything else is no draft', () => {
    const d = gameDraftOf(stored, null);
    expect(parseGameDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseGameDraft(null)).toBeNull();
    expect(parseGameDraft([])).toBeNull();
    expect(parseGameDraft({ ...d, sport_key: 'curling' })).toBeNull();
    expect(parseGameDraft({ ...d, side1_team_id: 'x' })).toBeNull();
    expect(parseGameDraft({ ...d, coverage: 'all' })).toBeNull();
    expect(parseGameDraft({ ...d, side1: 'x'.repeat(81) })).toBeNull();
    expect(parseGameDraft({ ...d, stats_hidden: 'yes' })).toBeNull();
  });
});

describe('the flow and the writer', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');
  it('a game without a sport cannot leave Details; no game, or a sport, goes on', () => {
    const base = { videoId: 'x', linkTyped: true, title: '', owner: null };
    expect(canAdvanceVideoStep('details', base)).toEqual({ ok: true });
    expect(canAdvanceVideoStep('details', { ...base, gameNeedsSport: false })).toEqual({ ok: true });
    expect(canAdvanceVideoStep('details', { ...base, gameNeedsSport: true })).toMatchObject({ ok: false });
  });
  it('the flow saves the game after the video, through the shared fields, and names a miss with the door to the page', () => {
    const flow = read('src/components/videos/NewVideoFlow.tsx');
    expect(flow).toContain('<GameFields value={gameDraft} onChange={changeGame} teams={teams} name="new-video-game" />');
    expect(flow).toContain('body: JSON.stringify(gameBodyOf(game))');
    expect(flow).toContain("ownerOrg && teamsRead?.orgId === ownerOrg ? gameDraft : withoutTeams(gameDraft)");
    expect(flow).toContain('setExistingId(data.video.id);');
    expect(flow.indexOf("fetch('/api/videos'")).toBeLessThan(flow.indexOf('gameBodyOf(game)'));
    expect(read('src/components/videos/GameDetailsCard.tsx')).toContain('body: JSON.stringify(gameBodyOf(draft)),');
  });
  it('a side\'s team is one of the video\'s own organization\'s — never any team that exists', () => {
    const server = read('src/lib/videos/video-games-server.ts');
    expect(server).toContain("if (!orgId) return { ok: false, status: 400, error: NOT_OWN_TEAM };");
    expect(server).toContain(".eq('org_id', orgId).in('id', ids)");
    expect(read('src/app/api/videos/[id]/game/route.ts')).toContain('saveGame(admin, id, parsed.value, user.id, read.row.org_id ?? null)');
  });
});
