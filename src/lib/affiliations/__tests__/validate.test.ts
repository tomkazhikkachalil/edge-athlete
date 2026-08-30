import { describe, expect, it } from 'vitest';
import {
  AffiliationClubTargetSchema,
  AffiliationLeagueTargetSchema,
  AffiliationAcceptClubSchema,
} from '../validate';

const ID = '2f1b46c8-2964-4139-9689-d1c3f736ed93';

describe('affiliation schemas', () => {
  it('target schemas require their side-specific uuid', () => {
    expect(AffiliationClubTargetSchema.safeParse({ clubId: ID }).success).toBe(true);
    expect(AffiliationClubTargetSchema.safeParse({ clubId: 'nope' }).success).toBe(false);
    expect(AffiliationLeagueTargetSchema.safeParse({ leagueId: ID }).success).toBe(true);
    expect(AffiliationLeagueTargetSchema.safeParse({}).success).toBe(false);
  });

  it("accept schema requires action: 'accept' exactly", () => {
    expect(AffiliationAcceptClubSchema.safeParse({ clubId: ID, action: 'accept' }).success).toBe(true);
    expect(AffiliationAcceptClubSchema.safeParse({ clubId: ID, action: 'decline' }).success).toBe(false);
    expect(AffiliationAcceptClubSchema.safeParse({ clubId: ID }).success).toBe(false);
  });
});
