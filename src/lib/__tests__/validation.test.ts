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

  it('boundedText trims, requires non-empty, enforces max', () => {
    expect(boundedText(10).parse('  hi  ')).toBe('hi');
    expect(boundedText(10).safeParse('   ').success).toBe(false);        // empty after trim
    expect(boundedText(3).safeParse('toolong').success).toBe(false);     // over max
  });

  it('emailString normalizes case + trims and validates', () => {
    expect(emailString.parse('  Tom@Example.COM ')).toBe('tom@example.com');
    expect(emailString.safeParse('nope').success).toBe(false);
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
