import { describe, expect, it } from 'vitest';
import { parseContact, parseDocuments, parseHeroConfig, parseSponsors } from '@/lib/org-sites/validate';
import {
  ContactConfigSchema,
  CoursesConfigSchema,
  DocumentsConfigSchema,
  GalleryConfigSchema,
  HeroConfigSchema,
  SponsorsConfigSchema,
} from '../schemas';

const SITE = '11111111-1111-4111-8111-111111111111';
const COURSE = '22222222-2222-4222-8222-222222222222';
const MEDIA = '33333333-3333-4333-8333-333333333333';
const IMG = `org-media/${SITE}/hero.jpg`;
const PDF = `org-media/${SITE}/policy.pdf`;

describe('widget config schemas (stored shapes)', () => {
  it('a hero config that the render parser accepts parses here, and unknown keys survive', () => {
    const raw = { headline: 'Play here', tagline: 'Since 1962', imagePath: IMG, imageAlt: 'tee', ctaLabel: 'Book', ctaUrl: 'https://x.test/book', notice: 'Cart path only', noticeUntil: '2026-09-30', legacyKey: 1 };
    expect(parseHeroConfig(raw).headline).toBe('Play here');
    const parsed = HeroConfigSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    expect((parsed.data as Record<string, unknown>).legacyKey).toBe(1);
    expect(HeroConfigSchema.safeParse({ ctaUrl: 'http://insecure.test' }).success).toBe(false);
    expect(HeroConfigSchema.safeParse({ imagePath: 'org-media/other-site/x.jpg' }).success).toBe(false);
  });

  it('sponsors: what parseSponsors returns round-trips; http links and >20 entries are rejected', () => {
    const raw = { sponsors: [{ name: 'Acme', url: 'https://acme.test', logoPath: IMG }, { name: 'Bare' }] };
    const parsedSponsors = parseSponsors(raw);
    expect(parsedSponsors).toHaveLength(2);
    expect(SponsorsConfigSchema.safeParse({ sponsors: parsedSponsors }).success).toBe(true);
    expect(SponsorsConfigSchema.safeParse({ sponsors: [{ name: 'X', url: 'http://x.test' }] }).success).toBe(false);
    expect(SponsorsConfigSchema.safeParse({ sponsors: Array.from({ length: 21 }, (_, i) => ({ name: `S${i}` })) }).success).toBe(false);
    // The bare module config (no sponsors key) is a valid empty config.
    expect(SponsorsConfigSchema.safeParse({}).success).toBe(true);
  });

  it('documents: file XOR link as stored; parseDocuments output round-trips', () => {
    const raw = { documents: [{ title: 'Policy', path: PDF }, { title: 'Rules', url: 'https://rules.test/x.pdf' }] };
    const parsedDocs = parseDocuments(raw);
    expect(parsedDocs).toHaveLength(2);
    expect(DocumentsConfigSchema.safeParse({ documents: parsedDocs }).success).toBe(true);
    expect(DocumentsConfigSchema.safeParse({ documents: [{ title: 'Bad', path: 'org-media/other/x.pdf' }] }).success).toBe(false);
  });

  it('contact: parseContact output round-trips', () => {
    const raw = {
      email: 'club@example.com',
      phone: '+1 555 0100',
      website: 'https://club.test',
      address: ['1 Fairway Dr', 'Ottawa'],
      hours: 'Dawn to dusk',
      directionsUrl: 'https://maps.test/x',
      social: { instagram: 'https://instagram.com/club' },
    };
    const parsedContact = parseContact(raw);
    expect(parsedContact.email).toBe('club@example.com');
    expect(ContactConfigSchema.safeParse(parsedContact).success).toBe(true);
    expect(ContactConfigSchema.safeParse({ address: ['a', 'b', 'c', 'd'] }).success).toBe(false);
  });

  it('gallery picks and course photos', () => {
    expect(GalleryConfigSchema.safeParse({ picks: [{ mediaId: MEDIA, postId: MEDIA, profileId: MEDIA, addedAt: '2026-09-09T00:00:00Z' }], other: true }).success).toBe(true);
    expect(GalleryConfigSchema.safeParse({ picks: [{ mediaId: 'not-a-uuid' }] }).success).toBe(false);
    // As set_course_photo stores it: `{ photos: { [courseId]: … } }`.
    expect(CoursesConfigSchema.safeParse({ photos: { [COURSE]: { path: IMG, alt: 'The 9th', holes: { 9: { path: IMG } } } } }).success).toBe(true);
    expect(CoursesConfigSchema.safeParse({ photos: {} }).success).toBe(true);
    expect(CoursesConfigSchema.safeParse({}).success).toBe(true);
    expect(CoursesConfigSchema.safeParse({ photos: { [COURSE]: { holes: { 19: { path: IMG } } } } }).success).toBe(false);
    expect(CoursesConfigSchema.safeParse({ photos: { 'not-a-course': {} } }).success).toBe(false);
  });

});
