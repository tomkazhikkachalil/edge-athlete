// ── A team's look (teams & divisions program, PR 6) — PURE ────────────────────
// Tom: the team page uses the TEAM's colours and falls back to the club's.
// The same accent shape the org page renders (OrgBrand.accent): a fill, its
// strong end, and a text colour readable on each surface (≥ 4.5:1 through
// readableOn — the house accent rule). A team with no colours reads the
// org's accent; the logo likewise falls back to the org's. Node-tested.

import { APP_SURFACE_DARK, APP_SURFACE_LIGHT, mixHex, readableOn } from '@/lib/org-sites/accent-contrast';
import type { OrgBrand } from '@/lib/org-sites/brand-types';
import { teamLogoUrl } from './logo-url';

export interface TeamLook {
  logoUrl: string | null;
  accent: OrgBrand['accent'];
  /** 'team' = the team's own colours; 'org' = the club's; null = the app palette. */
  source: 'team' | 'org' | null;
}

const HEX = /^#[0-9a-f]{6}$/;

export function teamLook(
  team: { id: string; logo_path?: string | null; primary_color?: string | null; secondary_color?: string | null },
  orgBrand: OrgBrand | null
): TeamLook {
  const logoUrl = teamLogoUrl(team.id, team.logo_path) ?? orgBrand?.logoUrl ?? null;
  const primary = team.primary_color && HEX.test(team.primary_color) ? team.primary_color : null;
  if (!primary) return { logoUrl, accent: orgBrand?.accent ?? null, source: orgBrand?.accent ? 'org' : null };
  const secondary = team.secondary_color && HEX.test(team.secondary_color) ? team.secondary_color : null;
  // The gradient's strong end: the second colour, else the first deepened.
  const strong = secondary ?? mixHex(primary, '#000000', 0.25);
  return {
    logoUrl,
    accent: {
      fill: primary,
      fillStrong: strong,
      fgLight: readableOn(strong, APP_SURFACE_LIGHT) ?? strong,
      fgDark: readableOn(primary, APP_SURFACE_DARK) ?? primary,
    },
    source: 'team',
  };
}
