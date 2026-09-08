import { describe, expect, it } from 'vitest';
import { siteDraftToContact } from '../approval';

describe('siteDraftToContact', () => {
  it('lifts website + phone; nothing → null; junk → null', () => {
    expect(siteDraftToContact({ contact: { website: 'https://x.example', phone: '613-555-0100' } })).toEqual({
      website: 'https://x.example',
      phone: '613-555-0100',
    });
    expect(siteDraftToContact({ sports: ['golf'] })).toBeNull();
    expect(siteDraftToContact({ contact: { website: 'http://x.example' } })).toBeNull();
    expect(siteDraftToContact(null)).toBeNull();
    expect(siteDraftToContact('garbage')).toBeNull();
  });
});

