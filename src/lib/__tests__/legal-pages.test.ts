import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// The legal pages caught up (Nov 2 2026): the date moves with the pages,
// and every processor the app talks to is named in the privacy policy —
// a new service with no sentence here is what this pin refuses.
const read = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');

describe('the legal pages', () => {
  const privacy = read('src/app/(app)/privacy/page.tsx');
  const terms = read('src/app/(app)/terms/page.tsx');

  it('carry one date, November 2026 or later', () => {
    const m = /export const LEGAL_LAST_UPDATED = '([A-Z][a-z]+) (\d{4})'/.exec(read('src/lib/legal.ts'));
    expect(m, 'LEGAL_LAST_UPDATED').toBeTruthy();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const stamp = Number(m![2]) * 12 + months.indexOf(m![1]);
    expect(stamp).toBeGreaterThanOrEqual(2026 * 12 + 10);
    expect(privacy).toContain('LEGAL_LAST_UPDATED');
    expect(terms).toContain('LEGAL_LAST_UPDATED');
    expect(privacy).not.toContain('July 2026');
    expect(terms).not.toContain('July 2026');
  });

  it('the privacy policy names every processor and source the app uses', () => {
    for (const name of ['Supabase', 'Vercel', 'Google', 'YouTube', 'Sentry', 'Open-Meteo', 'Golf course data providers', 'GIPHY', 'Logo.dev']) {
      expect(privacy, name).toContain(name);
    }
  });

  it('the privacy policy covers push, cookies, children and guardians, the data export, deletion, support tickets and the coming-soon list', () => {
    for (const phrase of ['push', 'Cookies', 'Children and guardians', 'Download your data', 'Delete your account', 'tickets', 'coming-soon']) {
      expect(privacy, phrase).toContain(phrase);
    }
    expect(privacy).toContain('30-day window');
    expect(privacy).toContain('location metadata removed');
  });

  it('the terms say the guardian rule and that results outlive the person', () => {
    expect(terms).toContain('parent or guardian creates and manages the profile');
    expect(terms).toContain('download a copy of your data');
    expect(terms).toContain('results sheet');
  });

  // What Google's reviewer and YouTube's API policy look for (Nov 11 2026): the policies LINKED, not only named.
  it('both pages link YouTube\'s Terms of Service and Google\'s Privacy Policy; the privacy policy says "YouTube API Services", what is kept, and where access is revoked', () => {
    for (const page of [privacy, terms]) {
      expect(page).toContain('href="https://www.youtube.com/t/terms"');
      expect(page).toContain('href="https://policies.google.com/privacy"');
      const external = page.match(/<a href="https:\/\/[^>]*>/g) ?? [];
      expect(external.length).toBeGreaterThanOrEqual(2);
      for (const tag of external) expect(tag, tag).toContain('rel="noopener noreferrer"');
    }
    expect(privacy).toContain('YouTube API Services');
    expect(privacy).toContain('href="https://myaccount.google.com/permissions"');
    expect(privacy).toMatch(/deleted when you disconnect/);
    expect(privacy).toMatch(/never sold and never used for advertising/);
    expect(terms).toMatch(/you also agree to YouTube&apos;s Terms of Service/);
  });
  it('the coming-soon page — the home page while the gate is up — links the privacy policy, the terms and contact, each on the gate\'s open list', () => {
    const soon = read('src/components/ComingSoon.tsx');
    const gate = read('src/lib/launch-gate.ts');
    for (const href of ['/privacy', '/terms', '/contact']) {
      expect(soon).toContain(`<Link href="${href}"`);
      expect(gate, href).toContain(`'${href}'`);
    }
    expect(soon).toContain('data-coming-soon-legal=""');
  });
});
