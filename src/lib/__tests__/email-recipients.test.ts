import { describe, it, expect } from 'vitest';
import { isReservedAddress, onlyReservedRecipients, recipientList } from '../email-recipients';

describe('isReservedAddress', () => {
  it('knows the standard undeliverable domains', () => {
    expect(isReservedAddress('edgeqa-abc@example.com')).toBe(true);
    expect(isReservedAddress('Edge QA <edgeqa@example.org>')).toBe(true);
    expect(isReservedAddress('x@mail.example.net')).toBe(true);
    expect(isReservedAddress('3f1c@departed.invalid')).toBe(true);
    expect(isReservedAddress('a@b.test')).toBe(true);
    expect(isReservedAddress('a@localhost')).toBe(true);
  });

  it('never blocks a real address', () => {
    expect(isReservedAddress('tom@edgeathlete.ca')).toBe(false);
    expect(isReservedAddress('someone@gmail.com')).toBe(false);
    expect(isReservedAddress('a@notexample.com')).toBe(false);
    expect(isReservedAddress('not-an-address')).toBe(false);
  });
});

describe('recipients', () => {
  it('flattens nodemailer shapes', () => {
    expect(recipientList('a@x.com, b@example.com', [{ address: 'c@y.com' }], undefined)).toEqual(['a@x.com', 'b@example.com', 'c@y.com']);
  });

  it('skips only when EVERY recipient is reserved', () => {
    expect(onlyReservedRecipients(['a@example.com', 'b@departed.invalid'])).toBe(true);
    expect(onlyReservedRecipients(['a@example.com', 'tom@edgeathlete.ca'])).toBe(false);
    expect(onlyReservedRecipients([])).toBe(false);
  });
});
