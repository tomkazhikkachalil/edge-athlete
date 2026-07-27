import { describe, it, expect } from 'vitest';
import {
  mapProfileUpsertError,
  isObfuscatedDuplicateSignUp,
} from '../signup-errors';

describe('mapProfileUpsertError', () => {
  it('maps 23505 on the handle constraint to handle-taken 409', () => {
    const r = mapProfileUpsertError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_handle_key"',
    });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/handle is already taken/i);
  });

  it('maps 23505 on the email constraint to email-registered 409', () => {
    const r = mapProfileUpsertError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_email_key"',
    });
    expect(r.status).toBe(409);
    expect(r.error).toMatch(/email is already registered/i);
  });

  it('maps 23505 with an unknown constraint to a generic conflict, not handle-taken', () => {
    const r = mapProfileUpsertError({
      code: '23505',
      message: 'duplicate key value violates unique constraint "profiles_pkey"',
    });
    expect(r.status).toBe(409);
    expect(r.error).not.toMatch(/handle/i);
  });

  it('does NOT report FK violations as handle-taken even when the text mentions duplicates (regression)', () => {
    const r = mapProfileUpsertError({
      code: '23503',
      message:
        'insert or update on table "profiles" violates foreign key constraint "profiles_id_fkey"',
      details: 'Key (id)=(x) is not present in table "users". No duplicate allowed.',
    });
    expect(r.status).toBe(500);
    expect(r.error).not.toMatch(/handle/i);
  });

  it('maps 23502 to a 400 missing-fields message', () => {
    const r = mapProfileUpsertError({ code: '23502', message: 'null value in column "display_name"' });
    expect(r.status).toBe(400);
    expect(r.error).toMatch(/required profile information/i);
  });

  it('passes unknown errors through as 500 with the message', () => {
    const r = mapProfileUpsertError({ code: 'PGRST204', message: "Could not find the 'dob' column" });
    expect(r.status).toBe(500);
    expect(r.error).toContain("Could not find the 'dob' column");
  });

  it('tolerates missing code and message', () => {
    const r = mapProfileUpsertError({});
    expect(r.status).toBe(500);
    expect(r.error).toContain('unknown');
  });
});

describe('isObfuscatedDuplicateSignUp', () => {
  it('is true for a sanitized user with empty identities', () => {
    expect(isObfuscatedDuplicateSignUp({ identities: [] })).toBe(true);
  });

  it('is true for a sanitized user with null identities', () => {
    expect(isObfuscatedDuplicateSignUp({ identities: null })).toBe(true);
  });

  it('is false for a genuine new user with an identity', () => {
    expect(isObfuscatedDuplicateSignUp({ identities: [{ provider: 'email' }] })).toBe(false);
  });

  it('is false when there is no user at all', () => {
    expect(isObfuscatedDuplicateSignUp(null)).toBe(false);
    expect(isObfuscatedDuplicateSignUp(undefined)).toBe(false);
  });
});
