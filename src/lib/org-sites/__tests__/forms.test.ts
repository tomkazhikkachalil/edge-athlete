import { afterEach, describe, expect, it } from 'vitest';
import { AGE_GROUPS, HONEYPOT_FIELD, formKindOf, parseFormFields, signFormToken, submissionSummary, verifyFormToken } from '../forms';

// Program 2, D (Sep 11 2026): the pure half of site forms — the kinds, the
// field schemas (an age GROUP, never a DOB), the form key in the preview
// token's secret family, the summary that never carries the message.

const SITE = '11111111-1111-4111-8111-111111111111';
const env = { ...process.env };
afterEach(() => {
  process.env.MEDIA_PROXY_SECRET = env.MEDIA_PROXY_SECRET;
  process.env.MEDIA_PROXY_SECRET_PREVIOUS = env.MEDIA_PROXY_SECRET_PREVIOUS;
});

describe('site forms', () => {
  it('two kinds; contact needs name, email, message; interest needs an age group and takes an optional phone and note; blanks are dropped', () => {
    expect(formKindOf('contact_form')).toBe('contact');
    expect(formKindOf('interest_form')).toBe('interest');
    expect(parseFormFields('contact', { name: ' Sam ', email: 'SAM@Example.com', message: 'Hi there' })).toEqual({ name: 'Sam', email: 'sam@example.com', message: 'Hi there' });
    expect(parseFormFields('contact', { name: 'Sam', email: 'not-an-email', message: 'Hi' })).toBeNull();
    expect(parseFormFields('contact', { name: 'Sam', email: 'sam@example.com', message: '' })).toBeNull();
    expect(parseFormFields('interest', { name: 'Sam', email: 'sam@example.com', ageGroup: 'U12', phone: '', message: '' })).toEqual({ name: 'Sam', email: 'sam@example.com', ageGroup: 'U12' });
    expect(parseFormFields('interest', { name: 'Sam', email: 'sam@example.com', ageGroup: '2014-05-01' })).toBeNull(); // a date of birth is never a field
    expect(parseFormFields('interest', { name: 'Sam', email: 'sam@example.com' })).toBeNull();
    expect(AGE_GROUPS).toContain('Adult');
    expect(HONEYPOT_FIELD).toBe('website');
  });
  it('the form key: signed with the current secret, verified against current or previous; no secret → none rendered, none required', () => {
    process.env.MEDIA_PROXY_SECRET = 'current-secret';
    process.env.MEDIA_PROXY_SECRET_PREVIOUS = 'old-secret';
    const token = signFormToken(SITE, 'w_1')!;
    expect(token).toBeTruthy();
    expect(verifyFormToken(SITE, 'w_1', token)).toBe(true);
    expect(verifyFormToken(SITE, 'w_2', token)).toBe(false);
    expect(verifyFormToken(SITE, 'w_1', null)).toBe(false);
    expect(verifyFormToken(SITE, 'w_1', 'x'.repeat(token.length))).toBe(false);
    process.env.MEDIA_PROXY_SECRET = 'rotated';
    expect(verifyFormToken(SITE, 'w_1', token)).toBe(false);
    process.env.MEDIA_PROXY_SECRET_PREVIOUS = 'current-secret';
    expect(verifyFormToken(SITE, 'w_1', token)).toBe(true);
    delete process.env.MEDIA_PROXY_SECRET;
    delete process.env.MEDIA_PROXY_SECRET_PREVIOUS;
    expect(signFormToken(SITE, 'w_1')).toBeNull();
    expect(verifyFormToken(SITE, 'w_1', null)).toBe(true);
  });
  it('the summary names the sender (and the age group), never the message', () => {
    expect(submissionSummary('contact', { name: 'Sam', email: 'sam@example.com', message: 'secret words' })).toBe('New message from Sam');
    expect(submissionSummary('interest', { name: 'Sam', email: 'sam@example.com', ageGroup: 'U12' })).toBe('New interest from Sam (U12)');
  });
});

// ── D2: the inbox's schema and the retention cutoffs ───────────────────────
import { FORM_RETENTION_DAYS, FormsPatchSchema, formPurgeCutoffs } from '../forms';

describe('the inbox (D2)', () => {
  it('a patch names a submission and at least means something; the cutoffs are 365 days archived, 730 open', () => {
    expect(FormsPatchSchema.safeParse({ id: '2f1b46c8-2964-4139-9689-d1c3f736ed93', read: true }).success).toBe(true);
    expect(FormsPatchSchema.safeParse({ id: 'nope', read: true }).success).toBe(false);
    expect(FORM_RETENTION_DAYS).toEqual({ archived: 365, open: 730 });
    const cut = formPurgeCutoffs(new Date('2026-09-11T12:00:00.000Z'));
    expect(cut.archivedBefore).toBe('2025-09-11T12:00:00.000Z');
    expect(cut.openBefore).toBe('2024-09-11T12:00:00.000Z');
  });
});
