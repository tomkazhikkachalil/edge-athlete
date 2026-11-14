import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { claimKey, linkTargets, parseClaimDecision, parseClaimRequest, parseLinkBody, parseLinkTarget, planLink } from '../tag-claims';

const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');
const P1 = '11111111-1111-4111-8111-111111111111';
const P2 = '22222222-2222-4222-8222-222222222222';

/** "This is me" (round 2 PR 4, migration 308): a typed name or a placeholder becomes a real profile's tags. */
describe('claimKey', () => {
  it('accents, case, punctuation and spacing do not make two people', () => {
    expect(claimKey('  José   O\'Neil-Smith ')).toBe("jose o'neil-smith");
    expect(claimKey('J. Smith')).toBe(claimKey('j smith'));
    expect(claimKey('Ann Lee')).not.toBe(claimKey('Ann Leigh'));
    expect(claimKey(null)).toBe('');
  });
});

describe('the bodies', () => {
  it('a target is a typed name XOR a placeholder player', () => {
    expect(parseLinkTarget({ name: '  Ann   Lee ' })).toEqual({ ok: true, value: { kind: 'name', name: 'Ann Lee' } });
    expect(parseLinkTarget({ profile_id: P1.toUpperCase() })).toEqual({ ok: true, value: { kind: 'placeholder', profileId: P1 } });
    expect(parseLinkTarget({ name: 'Ann', profile_id: P1 }).ok).toBe(false);
    expect(parseLinkTarget({}).ok).toBe(false);
    expect(parseLinkTarget({ name: '...' }).ok).toBe(false);
    expect(parseLinkTarget({ profile_id: 'x' }).ok).toBe(false);
    expect(parseLinkTarget({ name: 'x'.repeat(81) }).ok).toBe(false);
  });
  it('a request carries at most the name the athlete is under', () => {
    expect(parseClaimRequest({})).toEqual({ ok: true, value: { askedName: null } });
    expect(parseClaimRequest(null)).toEqual({ ok: true, value: { askedName: null } });
    expect(parseClaimRequest({ name: ' Ann  Lee ' })).toEqual({ ok: true, value: { askedName: 'Ann Lee' } });
    expect(parseClaimRequest({ name: '  ' })).toEqual({ ok: true, value: { askedName: null } });
    expect(parseClaimRequest({ name: 7 }).ok).toBe(false);
    expect(parseClaimRequest({ profile_id: P1 }).ok).toBe(false);
  });
  it('a decision approves WITH who they are, or declines with nothing', () => {
    expect(parseClaimDecision({ action: 'approve', target: { name: 'Ann' } })).toEqual({ ok: true, value: { action: 'approve', target: { kind: 'name', name: 'Ann' } } });
    expect(parseClaimDecision({ action: 'decline' })).toEqual({ ok: true, value: { action: 'decline' } });
    expect(parseClaimDecision({ action: 'approve' }).ok).toBe(false);
    expect(parseClaimDecision({ action: 'decline', target: { name: 'Ann' } }).ok).toBe(false);
    expect(parseClaimDecision({ action: 'maybe' }).ok).toBe(false);
    expect(parseClaimDecision({ action: 'approve', target: { name: 'Ann' }, extra: 1 }).ok).toBe(false);
  });
  it('a direct link names the target and the profile — never a placeholder to itself', () => {
    expect(parseLinkBody({ target: { name: 'Ann' }, profile_id: P1 })).toEqual({ ok: true, value: { target: { kind: 'name', name: 'Ann' }, profileId: P1 } });
    expect(parseLinkBody({ target: { profile_id: P1 }, profile_id: P1 }).ok).toBe(false);
    expect(parseLinkBody({ target: { profile_id: P1 }, profile_id: P2 }).ok).toBe(true);
    expect(parseLinkBody({ target: { name: 'Ann' } }).ok).toBe(false);
  });
});

describe('planLink', () => {
  const row = (id: string, highlight_id: string, video_id: string, role = 'scorer') => ({ id, highlight_id, video_id, role });
  it('every tag moves when the profile has nothing there', () => {
    expect(planLink([row('a', 'h1', 'v1'), row('b', 'h2', 'v1'), row('c', 'h3', 'v2')], [])).toEqual({ move: ['a', 'b', 'c'], drop: [], kept: 0 });
  });
  it('a tag the profile is already on in that role drops the linked row; another role moves', () => {
    const own = [{ highlight_id: 'h1', video_id: 'v1', role: 'scorer', status: 'active' }];
    expect(planLink([row('a', 'h1', 'v1', 'scorer'), row('b', 'h1', 'v1', 'in_clip')], own)).toEqual({ move: ['b'], drop: ['a'], kept: 0 });
  });
  it('two spellings on one tag in one role: one moves, the other is dropped', () => {
    expect(planLink([row('a', 'h1', 'v1'), row('b', 'h1', 'v1')], [])).toEqual({ move: ['a'], drop: ['b'], kept: 0 });
  });
  it('the profile is never linked back into what it left: a tag it removed itself from, or a game it left whole', () => {
    const leftTag = [{ highlight_id: 'h1', video_id: 'v1', role: 'scorer', status: 'removed' }, { highlight_id: 'h9', video_id: 'v1', role: 'scorer', status: 'active' }];
    expect(planLink([row('a', 'h1', 'v1', 'assist'), row('b', 'h2', 'v1')], leftTag)).toEqual({ move: ['b'], drop: [], kept: 1 });
    const leftGame = [{ highlight_id: 'h1', video_id: 'v1', role: 'scorer', status: 'removed' }];
    expect(planLink([row('a', 'h2', 'v1'), row('b', 'h3', 'v2')], leftGame)).toEqual({ move: ['b'], drop: [], kept: 1 });
  });
});

describe('linkTargets', () => {
  it('each typed name once (by key, first spelling), each placeholder, with clips; a real profile and a masked stand-in are never targets', () => {
    const people = [
      { highlight_id: 'h1', profile_id: null, name: 'J. Smith' },
      { highlight_id: 'h2', profile_id: null, name: 'j smith' },
      { highlight_id: 'h2', profile_id: P1, name: 'Stub Player' },
      { highlight_id: 'h3', profile_id: P2, name: 'Real Athlete' },
      { highlight_id: 'h3', profile_id: null, name: 'Player 1', masked: true },
    ];
    expect(linkTargets(people, new Set([P1]))).toEqual([
      { kind: 'name', name: 'J. Smith', profile_id: null, clips: 2 },
      { kind: 'placeholder', name: 'Stub Player', profile_id: P1, clips: 1 },
    ]);
  });
});

describe('migration 308 and the writers', () => {
  const sql = read('database/migrations/308_video_tag_claims.sql');
  it('one table, every FK named with its index, one open request per person per game', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.video_tag_claims (');
    expect(sql).toContain("status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined'))");
    expect(sql).toContain('CONSTRAINT video_tag_claims_one_target_check CHECK (num_nonnulls(target_name, target_profile_id) <= 1)');
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS video_tag_claims_one_pending_uidx ON public.video_tag_claims (video_id, requester_profile_id) WHERE status = 'pending';");
    expect(sql).toContain('ADD CONSTRAINT video_tag_claims_video_id_fkey FOREIGN KEY (video_id) REFERENCES public.videos(id) ON DELETE CASCADE;');
    expect(sql).toContain('ADD CONSTRAINT video_tag_claims_requester_profile_id_fkey FOREIGN KEY (requester_profile_id) REFERENCES public.profiles(id) ON DELETE CASCADE;');
    for (const col of ['requested_by_user_id', 'target_profile_id', 'decided_by_user_id']) expect(sql).toContain(`ADD CONSTRAINT video_tag_claims_${col}_fkey FOREIGN KEY (${col}) REFERENCES public.profiles(id) ON DELETE SET NULL;`);
    for (const col of ['video_id', 'requester_profile_id', 'requested_by_user_id', 'target_profile_id', 'decided_by_user_id']) expect(sql).toContain(`CREATE INDEX IF NOT EXISTS video_tag_claims_${col}_idx ON public.video_tag_claims (${col});`);
  });
  it('posture A, the grant, the pre-flight, the ledger footer and the result row', () => {
    expect(sql).toContain('ALTER TABLE public.video_tag_claims ENABLE ROW LEVEL SECURITY;');
    expect(sql).toContain('REVOKE ALL ON TABLE public.video_tag_claims FROM PUBLIC, anon, authenticated;');
    expect(sql).toContain('GRANT ALL ON TABLE public.video_tag_claims TO service_role;');
    expect(sql).not.toContain('CREATE POLICY');
    expect(sql).toContain("IF n < 307 THEN RAISE EXCEPTION '308 pre-flight: ledger head is %, expected 307', n; END IF;");
    expect(sql).toContain("INSERT INTO public.schema_migrations (number, name) VALUES (308, '308_video_tag_claims.sql') ON CONFLICT (number) DO NOTHING;");
    expect(sql).toContain("SELECT '308 APPLIED' AS result");
    expect(read('src/lib/account-departure.ts')).toContain("'video_tag_claims.requester_profile_id': 'goes',");
  });
  it('a real athlete\'s tags are never moved: a placeholder target must be a roster stub, and nobody is linked TO a stub', () => {
    const server = read('src/lib/videos/videos-server.ts');
    expect(server).toContain("if (!stub || !isStubEmail((stub as { email: string | null }).email)) return { ok: false, status: 400, error: 'Only a player without an account can be linked to a profile' };");
    expect(server).toContain('if (isStubEmail(toRow.email)) return { ok: false, status: 400');
    expect(server).toContain("update({ profile_id: toProfileId, name: null }).in('id', plan.move)");
  });
  it('a manager\'s direct link is under the who-may-be-tagged rule; an approved request is not (the athlete asked); both are the managers\' alone', () => {
    const link = read('src/app/api/videos/[id]/links/route.ts');
    expect(link).toContain("getServerAuth(request, { limit: 'video-write' })");
    expect(link).toContain("if (!read.canManage) return NextResponse.json({ error: 'Only a manager can link people in this video.' }, { status: 403, headers: PRIVATE });");
    expect(link).toContain('{ checkWho: true }');
    const decide = read('src/app/api/videos/[id]/claims/[claimId]/route.ts');
    expect(decide).toContain("if (!read.canManage) return NextResponse.json({ error: 'Only a manager can decide this request.' }, { status: 403, headers: PRIVATE });");
    const claims = read('src/lib/videos/video-claims-server.ts');
    expect(claims).toContain('{ checkWho: false }');
    expect(claims).toContain(".eq('status', 'pending')\n    .select('id');");
    expect(claims).toContain("if (claim.status !== 'pending') return { ok: false, status: 409, error: 'That request was already decided' };");
  });
  it('a request needs only the right to see the video; a non-manager reads only their own — and their supervised athletes\' (Nov 14)', () => {
    const route = read('src/app/api/videos/[id]/claims/route.ts');
    expect(route).toContain('const wards = await guardedAthletes(admin, user.id);');
    expect(route).toContain('return NextResponse.json({ can_manage: false, mine: await myClaim(admin, id, user.id), athletes }, { headers: PRIVATE });');
    // A guardian asks FOR a child through the one acting-as gate (role and consent); who pressed the button is kept apart.
    expect(route).toContain("resolveActingProfile(user.id, request.nextUrl.searchParams.get('profileId'), 'Only the athlete or their guardian can ask this')");
    expect(route).toContain('requestClaim(admin, { id, title: read.row.title ?? null, created_by_user_id: read.row.created_by_user_id ?? null }, acting.actorId, user.id, parsed.value.askedName)');
    const claims = read('src/lib/videos/video-claims-server.ts');
    expect(claims).toContain("if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) return [];");
    expect(claims).toContain(".eq('role', 'guardian')");
  });
});
