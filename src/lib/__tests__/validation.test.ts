import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { uuid, boundedText, emailString, parseBody } from '../validation';

const req = (body: unknown) =>
  new Request('http://test/api', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('primitives', () => {
  it('uuid accepts a valid UUID and rejects garbage', () => {
    expect(uuid.safeParse('2132330f-e125-43e9-99c1-20bd09e6113f').success).toBe(true);
    expect(uuid.safeParse('not-a-uuid').success).toBe(false);
  });

  it('uuid accepts every variant the zod-3 form accepted', () => {
    // Pinned during the zod 3 -> 4 upgrade: z.string().uuid() became z.uuid(),
    // and v4 tightened RFC conformance. These are the shapes Supabase and
    // Postgres actually hand us, so a stricter validator here would 404 real
    // rows rather than catch bad input.
    for (const v of [
      '2132330f-e125-43e9-99c1-20bd09e6113f',        // v4
      '01890a5d-ac96-774b-bcce-b302099a8057',        // v7
      '00000000-0000-0000-0000-000000000000',        // nil
      'ffffffff-ffff-ffff-ffff-ffffffffffff',        // max
      '2132330F-E125-43E9-99C1-20BD09E6113F',        // uppercase
    ]) {
      expect(uuid.safeParse(v).success, v).toBe(true);
    }
  });

  it('boundedText trims, requires non-empty, enforces max', () => {
    expect(boundedText(10).parse('  hi  ')).toBe('hi');
    expect(boundedText(10).safeParse('   ').success).toBe(false);        // empty after trim
    expect(boundedText(3).safeParse('toolong').success).toBe(false);     // over max
  });

  it('emailString normalizes case + trims and validates', () => {
    expect(emailString.parse('  Tom@Example.COM ')).toBe('tom@example.com');
    expect(emailString.safeParse('nope').success).toBe(false);
  });

  it('emailString normalizes BEFORE validating, not after', () => {
    // The ordering is the whole point, and zod 4 makes it easy to get wrong:
    // the natural-looking `z.email().trim().toLowerCase()` validates the raw
    // input and rejects padded addresses. Every one of these arrives from a
    // real form where the user pasted with whitespace or typed in caps.
    for (const v of ['  tom@example.com', 'tom@example.com  ', '\tTOM@EXAMPLE.COM\n']) {
      const r = emailString.safeParse(v);
      expect(r.success, JSON.stringify(v)).toBe(true);
      if (r.success) expect(r.data).toBe('tom@example.com');
    }
  });
});

describe('parseBody', () => {
  const Schema = z.object({ name: boundedText(20), age: z.number().int() });

  it('returns typed data on success', async () => {
    const parsed = await parseBody(req({ name: 'Tom', age: 30 }), Schema);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.name).toBe('Tom');
      expect(parsed.data.age).toBe(30);
    }
  });

  it('returns a 400 response with a field-scoped message on invalid input', async () => {
    const parsed = await parseBody(req({ name: '', age: 30 }), Schema);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.response.status).toBe(400);
      const json = await parsed.response.json();
      expect(json.error).toContain('name');
    }
  });

  it('returns a 400 for malformed JSON (not a 500)', async () => {
    const badReq = new Request('http://test/api', { method: 'POST', body: '{ not json' });
    const parsed = await parseBody(badReq, Schema);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.response.status).toBe(400);
      const json = await parsed.response.json();
      expect(json.error).toBe('Invalid JSON body');
    }
  });

  it('a .strict() schema rejects unknown keys (mass-assignment guard)', async () => {
    const Strict = z.object({ email_enabled: z.boolean() }).partial().strict();
    const parsed = await parseBody(req({ user_id: 'attacker', email_enabled: true }), Strict);
    expect(parsed.success).toBe(false);
  });
});
