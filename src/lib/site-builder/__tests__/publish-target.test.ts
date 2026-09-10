import { describe, expect, it } from 'vitest';
import { publishPlan } from '../publish-target';

// Hardening H6: a not-yet-live site publishes THE SITE from the editor.
describe('publishPlan', () => {
  it('live → promote the draft; not live → take the site live, with a fallback message for manage_site staff', () => {
    expect(publishPlan(true)).toEqual({ target: 'revisions', cta: 'Publish changes', success: 'Changes published', forbidden: null });
    const fresh = publishPlan(false);
    expect(fresh.target).toBe('site');
    expect(fresh.cta).toBe('Publish site');
    expect(fresh.success).toMatch(/live/);
    expect(fresh.forbidden).toMatch(/owner or manager/);
  });
});
