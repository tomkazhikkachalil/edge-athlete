import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Results-kept round PR 3 (241, Sep 26 2026). Tom: self-untag is fine —
// except from an OFFICIAL result; a wrong person is corrected by support;
// "make sure individuals know if they've been untagged from an official
// result … both sides stay accountable." Pinned by source (the doors are
// route handlers; the official walk is unit-tested in results-official).

const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('an official result is never untagged or rewritten by its player', () => {
  it('both untag branches refuse an official post before any write', () => {
    const del = read('src/app/api/tags/route.ts').split('export async function DELETE')[1];
    const selfBranch = del.split('if (!tagId)')[0];
    expect(selfBranch.indexOf("resolveResultOrigin(supabase, { kind: 'post', id: postId })")).toBeGreaterThan(-1);
    expect(selfBranch.indexOf('resolveResultOrigin(')).toBeLessThan(selfBranch.indexOf(".upsert("));
    const tagBranch = del.split('if (!tagId)')[1];
    expect(tagBranch.indexOf("resolveResultOrigin(supabase, { kind: 'post', id: tag.post_id })")).toBeGreaterThan(-1);
    expect(tagBranch.indexOf('resolveResultOrigin(')).toBeLessThan(tagBranch.indexOf(".update({ status: 'removed' })"));
  });
  it('the post edit keeps self-untag markers and refuses a tag change on an official post', () => {
    const put = read('src/app/api/posts/route.ts').split('export async function PUT')[1].split('export async function')[0];
    expect(put).toMatch(/taggedProfiles = taggedProfiles\.filter\(id => !removed\.has\(id\)\)/);
    expect(put).toMatch(/if \(changed && \(await resolveResultOrigin\(supabase, \{ kind: 'post', id: postId \}\)\)\.official\)/);
    expect((put.match(/\.neq\('status', 'removed'\)/g) ?? []).length).toBe(2);
  });
  it('a player cannot rewrite an official round’s scores', () => {
    const patch = read('src/app/api/golf/rounds/[roundId]/route.ts').split('export async function PATCH')[1].split('export async function')[0];
    expect(patch).toMatch(/resolveResultOrigin\(supabase, \{ kind: 'golf_round', id: roundId \}\)\)\.official\) \{\s*return NextResponse\.json\(\{ error: OFFICIAL_RESULT_REFUSAL/);
  });
  it('media (photo) tags stay the person’s to remove — likeness and guardian consent (Tom flag 1)', () => {
    expect(read('src/app/api/profile/[profileId]/contest-media/route.ts')).not.toMatch(/resolveResultOrigin|OFFICIAL_RESULT_REFUSAL/);
  });
});

describe('a person taken off an official record is told, and it is logged', () => {
  it('the one helper bells the person and writes the org’s authority log', () => {
    const src = read('src/lib/results/notify-server.ts');
    expect(src).toMatch(/type: 'authority_notice'/);
    expect(src).toMatch(/await recordAuthority\(admin, \{\s*subject: \{ type: 'org', id: c\.orgId \}/);
  });
  it.each([
    ['src/lib/orgs/stat-lines-server.ts', 'statLineDELETE'],
    ['src/lib/orgs/contest-media-server.ts', 'contestMediaTagDELETE'],
    ['src/lib/orgs/competition-server.ts', 'entryDELETE'],
  ])('%s %s tells the athlete', (file, fn) => {
    const body = read(file).split(`export async function ${fn}(`)[1].split('\nexport ')[0];
    expect(body).toMatch(/await tellOfficialChange\(admin, \{ profileId[:,]/);
  });
  it('the org routes pass the acting staff member', () => {
    expect(read('src/lib/orgs/routes/competitions-one-stat-lines.ts')).toMatch(/statLineDELETE\(ctx\.admin, lineId, \{ side: kind, orgId: ctx\.id \}, ctx\.user\.id\)/);
    expect(read('src/lib/orgs/routes/competitions-one-media-tags.ts')).toMatch(/\}, ctx\.user\.id\);/);
    expect(read('src/lib/orgs/routes/competitions-entries.ts')).toMatch(/entryDELETE\(admin, entryId, \{ side: kind, orgId: id \}, user\.id\)/);
  });
});
