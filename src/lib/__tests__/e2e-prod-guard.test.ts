import { describe, expect, it } from 'vitest';
import { PROD_APP_HOST, PROD_SUPABASE_REF, refuseProdUnlessAllowed } from '../../../e2e/helpers/qa-user';

// Round 2: the e2e suite runs on staging; production is refused unless the
// prod probe's flag is set. Pinned so the refusal cannot quietly go away.

describe('refuseProdUnlessAllowed', () => {
  it('lets staging through, with or without the flag', () => {
    expect(() => refuseProdUnlessAllowed('https://xrfhbcxarlqfarvazokt.supabase.co', 'http://localhost:3000', undefined)).not.toThrow();
    expect(() => refuseProdUnlessAllowed(undefined, 'http://localhost:3000', undefined)).not.toThrow();
  });
  it('refuses the prod project and the prod host without the flag', () => {
    expect(() => refuseProdUnlessAllowed(`https://${PROD_SUPABASE_REF}.supabase.co`, 'http://localhost:3000', undefined)).toThrow(/PRODUCTION Supabase/);
    expect(() => refuseProdUnlessAllowed('https://xrfhbcxarlqfarvazokt.supabase.co', `https://${PROD_APP_HOST}`, '0')).toThrow(/PRODUCTION app/);
  });
  it('admits both with E2E_ALLOW_PROD=1', () => {
    expect(() => refuseProdUnlessAllowed(`https://${PROD_SUPABASE_REF}.supabase.co`, `https://${PROD_APP_HOST}`, '1')).not.toThrow();
  });
});
