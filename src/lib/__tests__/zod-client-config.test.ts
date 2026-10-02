import { describe, it, expect } from 'vitest';
import { applyZodJitless } from '../zod-client-config';

describe('zod jitless without importing zod on every page', () => {
  it('the flag written before zod loads is the one zod reads', async () => {
    applyZodJitless();
    const { z } = await import('zod');
    expect(z.config().jitless).toBe(true);
    // …and a schema still parses (the interpreted path).
    expect(z.object({ a: z.number() }).parse({ a: 1 })).toEqual({ a: 1 });
  });
  it('lands on an existing config object rather than replacing it', () => {
    const target: { __zod_globalConfig?: Record<string, unknown> } = { __zod_globalConfig: { customError: 'x' } };
    applyZodJitless(target);
    expect(target.__zod_globalConfig).toEqual({ customError: 'x', jitless: true });
  });
});
