import { describe, expect, it } from 'vitest';
import { REVISION_LABEL_MAX, RevisionActionSchema } from '@/lib/org-sites/validate';

const ID = '11111111-1111-4111-8111-111111111111';

describe('RevisionActionSchema', () => {
  it('accepts the four actions', () => {
    expect(RevisionActionSchema.safeParse({ action: 'publish' }).success).toBe(true);
    expect(RevisionActionSchema.safeParse({ action: 'publish', label: '  Launch  ' }).data).toEqual({ action: 'publish', label: 'Launch' });
    expect(RevisionActionSchema.safeParse({ action: 'publish', label: '' }).data).toEqual({ action: 'publish', label: undefined });
    expect(RevisionActionSchema.safeParse({ action: 'discard' }).success).toBe(true);
    expect(RevisionActionSchema.safeParse({ action: 'restore', revisionId: ID }).success).toBe(true);
    expect(RevisionActionSchema.safeParse({ action: 'label', revisionId: ID, label: 'v2' }).success).toBe(true);
    expect(RevisionActionSchema.safeParse({ action: 'label', revisionId: ID, label: null }).success).toBe(true);
  });

  it('rejects an over-long label, a blank label on label, a non-uuid, an unknown action', () => {
    expect(REVISION_LABEL_MAX).toBe(60);
    expect(RevisionActionSchema.safeParse({ action: 'publish', label: 'x'.repeat(61) }).success).toBe(false);
    expect(RevisionActionSchema.safeParse({ action: 'label', revisionId: ID, label: '   ' }).success).toBe(false);
    expect(RevisionActionSchema.safeParse({ action: 'restore', revisionId: 'nope' }).success).toBe(false);
    expect(RevisionActionSchema.safeParse({ action: 'restore' }).success).toBe(false);
    expect(RevisionActionSchema.safeParse({ action: 'unpublish' }).success).toBe(false);
  });
});
