// The team logo's public URL — PURE and client-safe (teams & divisions, PR 6).
// The server writer (logo-server.ts) and the look (brand.ts) share it.

export const TEAM_LOGO_PREFIX = 'team-logos/';

/** The streamer URL for a team's logo, or null (a path outside the team's own prefix is no logo). */
export function teamLogoUrl(teamId: string, logoPath: string | null | undefined): string | null {
  if (!logoPath || !logoPath.startsWith(`${TEAM_LOGO_PREFIX}${teamId}/`)) return null;
  const file = logoPath.slice(logoPath.lastIndexOf('/') + 1);
  return `/api/media/team-logo/${teamId}?v=${encodeURIComponent(file)}`;
}
