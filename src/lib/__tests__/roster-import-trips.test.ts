import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROSTER_IMPORT_CONCURRENCY } from '../orgs/roster-import';

// Scale audit row 12 (Nov 7 2026): a pasted roster was 50 × 5 SEQUENTIAL
// admin operations — two Auth calls per stub (create, then re-key the address
// to the id Auth chose), the stub RPC, the membership insert, the invite.
// Now: the id is minted by the caller, so the shadow user is ONE Auth call
// with its final address, and the rows run a few at a time (mapBounded) with
// the report in the pasted order. Measured on staging (e2e
// roster-import-batch): 50 rows 32.6 s → see the devlog for the after.

const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/orgs/roster-import.ts'), 'utf8');
const guardian = fs.readFileSync(path.join(process.cwd(), 'src/app/api/guardian/athletes/route.ts'), 'utf8');

describe('the roster import mints a stub with ONE Auth call and runs its rows bounded', () => {
  it('no re-key: createUser carries the minted id and the final stub address', () => {
    expect(src).not.toContain('updateUserById');
    expect(src).not.toContain('pending-');
    expect(src).toMatch(/const minted = randomUUID\(\);\s*let \{ data: created, error: userError \} = await admin\.auth\.admin\.createUser\(\{\s*id: minted,\s*email: makeStubEmail\(minted\),/);
    // A refused Auth call is NAMED in the log (status + message) and retried once, same id, same address.
    expect(src).toContain("console.error('[ROSTER IMPORT] shadow user create failed:'");
    expect(src).toMatch(/await new Promise\(r => setTimeout\(r, RETRY_PAUSE_MS\)\);\s*\(\{ data: created, error: userError \} = await admin\.auth\.admin\.createUser\(\{\s*id: minted,\s*email: makeStubEmail\(minted\),/);
    expect(src).toContain("console.error('[ROSTER IMPORT] shadow user create failed again:'");
    // An Auth that ignored the id is refused, not re-keyed.
    expect(src).toMatch(/if \(created\.user\.id !== minted\) \{\s*await admin\.auth\.admin\.deleteUser\(created\.user\.id\)\.catch\(\(\) => \{\}\);\s*return \{ name, profileId: null, claimUrl: null, emailSent: false, error: 'account' \};/);
  });
  it('the rows run through mapBounded at the import concurrency; the report is the ordered result', () => {
    expect(ROSTER_IMPORT_CONCURRENCY).toBe(5);
    expect(src).toContain("import { mapBounded } from '@/lib/bounded-map';");
    expect(src).toMatch(/const report = await mapBounded\(input\.rows, ROSTER_IMPORT_CONCURRENCY, importRow\);\s*return \{ ok: true, report \};/);
    // No sequential loop over the rows remains.
    expect(src).not.toMatch(/for \(const row of input\.rows\)/);
    // Per-row best-effort survives: every failure arm returns a report row with its error word.
    for (const word of ['account', 'profile', 'membership', 'unexpected']) {
      expect(src).toContain(`error: '${word}' }`);
    }
  });
  it('the compensation order is unchanged: profile delete (cascades) then the shadow user', () => {
    expect(src).toMatch(/await admin\.from\('profiles'\)\.delete\(\)\.eq\('id', profileId\);\s*await admin\.auth\.admin\.deleteUser\(profileId\)\.catch\(\(\) => \{\}\);/);
  });
});

describe('the guardian route mints its shadow user the same way', () => {
  it('one createUser carrying the minted id and the synthetic address; no re-key', () => {
    expect(guardian).not.toContain('updateUserById');
    expect(guardian).not.toMatch(/pending-\$\{randomBytes/); // the throwaway address that needed the re-key
    expect(guardian).toMatch(/const childId = randomUUID\(\);\s*const syntheticEmail = makeSyntheticEmail\(childId\);\s*const \{ data: created, error: createError \} = await admin\.auth\.admin\.createUser\(\{\s*id: childId,\s*email: syntheticEmail,/);
    expect(guardian).toContain("created.user.id !== childId");
  });
});
