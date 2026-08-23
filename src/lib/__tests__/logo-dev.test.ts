import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logoUrl, websiteDomain, LOGO_DEV_ENABLED } from '@/lib/logo-dev';

// NEXT_PUBLIC_LOGO_DEV_TOKEN is inlined at build time and is unset under
// vitest, so these run the disabled path — which is the one that must never
// make a request or render a broken image.
describe('logoUrl (no token configured)', () => {
  it('returns null rather than a tokenless URL', () => {
    expect(logoUrl('titleist.com', 24)).toBeNull();
  });

  it('is null for a brand with no domain', () => {
    expect(logoUrl(undefined, 24)).toBeNull();
  });

  it('reports the feature as disabled', () => {
    expect(LOGO_DEV_ENABLED).toBe(false);
  });
});

// Course `website` values are provider free text — forgiving in, strict out.
describe('websiteDomain', () => {
  it('extracts a bare domain from the shapes providers actually store', () => {
    expect(websiteDomain('https://www.ottawahuntclub.org/')).toBe('ottawahuntclub.org');
    expect(websiteDomain('http://rideauview.com/rates')).toBe('rideauview.com');
    expect(websiteDomain('pebblebeach.com')).toBe('pebblebeach.com');
    expect(websiteDomain('//www.example.golf')).toBe('example.golf');
    expect(websiteDomain('WWW.Example.COM:8080/x?y=1')).toBe('example.com');
  });

  it('returns null for junk — never a broken img request', () => {
    expect(websiteDomain(null)).toBeNull();
    expect(websiteDomain('')).toBeNull();
    expect(websiteDomain('   ')).toBeNull();
    expect(websiteDomain('call the pro shop')).toBeNull();
    expect(websiteDomain('localhost')).toBeNull();
  });
});

/**
 * Logo.dev's free plan is contractual, and both of these are easy to break
 * with an innocent-looking edit. Asserted against the source text because the
 * component's rendered output needs a DOM, and this repo is node-only.
 */
describe('Logo.dev attribution compliance', () => {
  const raw = readFileSync(join(process.cwd(), 'src/components/LogoDevAttribution.tsx'), 'utf8');
  // Strip comments first: the file documents the noreferrer rule in prose and
  // quotes the wrong-looking `rel="noopener noreferrer"` as the thing to
  // avoid, both of which would otherwise trip the assertions below.
  // The (?<!:) guard matters: a naive //-strip eats `https://logo.dev` and
  // then the required-href assertion passes or fails for the wrong reason.
  const source = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(?<!:)\/\/.*$/gm, '');

  it('uses their exact required wording', () => {
    expect(source).toContain('Logos provided by Logo.dev');
    expect(source).toContain('href="https://logo.dev"');
  });

  it('does NOT set rel="noreferrer" — verification needs the referrer', () => {
    // The reflexive rel="noopener noreferrer" on an external target="_blank"
    // link would strip the referrer and silently fail their verification.
    // Assert on the rel ATTRIBUTES only: the file's own comment explains the
    // rule and therefore contains the word "noreferrer" legitimately.
    const rels = [...source.matchAll(/\brel="([^"]*)"/g)].map(m => m[1]);
    expect(rels.length).toBeGreaterThan(0);
    for (const rel of rels) expect(rel).not.toContain('noreferrer');
    expect(rels).toContain('noopener');
  });

  it('renders nothing when no token is configured', () => {
    expect(source).toMatch(/if \(!LOGO_DEV_ENABLED\) return null/);
  });
});

describe('attribution placement', () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

  it('appears on a public page — the picker is behind login', () => {
    // Presence, not exact JSX — the call site may pass className (it does,
    // since the touch-target pass grew the footer link to a 44px row).
    expect(read('src/app/page.tsx')).toContain('<LogoDevAttribution');
  });

  it('appears on a page rendered WITHOUT JavaScript', () => {
    // `/` is a client component, so its footer credit only exists after
    // hydration — a verifier that does not run JS would see nothing. Terms is
    // a server component and statically prerendered, so it lands in the HTML.
    const terms = read('src/app/terms/page.tsx');
    expect(terms).toContain('<LogoDevCredits />');
    expect(terms).not.toContain("'use client'");
  });

  it('appears near the logos themselves in the equipment picker', () => {
    expect(read('src/components/AddEquipmentModal.tsx')).toContain('LogoDevAttribution');
  });
});
