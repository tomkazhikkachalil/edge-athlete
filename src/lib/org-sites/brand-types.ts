/**
 * The org's brand as the in-app page reads it (Org Pages R2, Sep 8 2026) —
 * a client-safe type module (the builder lives in brand.ts, server-side,
 * next to the zod parsers). Rides the org GET as `brand: OrgBrand | null`;
 * null = no site row at all. A DRAFT site's brand renders for everyone
 * (Tom's call: the org is live by link from creation, and the logo/hero
 * bytes are already anonymous through the tokenless streamers) — `published`
 * is exposed so managers can see a "Site draft" pill.
 */
export interface OrgBrand {
  siteId: string;
  subdomain: string;
  published: boolean;
  /** /api/media/org-logo/{siteId}?v=… or null. */
  logoUrl: string | null;
  hero: {
    /** /api/media/org-media/{siteId}/{file} or null (prefix re-asserted). */
    imageUrl: string | null;
    imageAlt: string;
    headline: string;
    tagline: string;
  };
  /** null when the site sets no accent tokens (the app palette stays). */
  accent: {
    /** The gradient start / fill. */
    fill: string;
    /** The gradient end. */
    fillStrong: string;
    /** Readable as TEXT on the light surface (≥ 4.5:1). */
    fgLight: string;
    /** Readable as TEXT on the dark surface (≥ 4.5:1). */
    fgDark: string;
  } | null;
}
