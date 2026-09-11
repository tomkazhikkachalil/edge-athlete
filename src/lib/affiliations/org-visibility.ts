// ── Which of a profile's orgs a VIEWER may see — pure (Sep 11 2026) ──────
// Tom's rule, written down:
//   * your OWN memberships always appear on your own profile, regardless of
//     the org's listing_status or visibility (a guardian sees the same);
//   * listing governs whether strangers can DISCOVER the org (directories,
//     sitemap, search, index) — never this strip;
//   * visibility governs what strangers see INSIDE the org — so on someone
//     else's profile a PRIVATE org shows only to a viewer who is themselves a
//     member of that org.
// A pre-176/177 row has no visibility column and reads as public.

export interface ViewerOrgFilterInput {
  /** The viewer is the profile itself or one of its guardians. */
  isSelfOrGuardian: boolean;
  /** `${side}:${orgId}` keys of the orgs the VIEWER belongs to. */
  viewerOrgKeys: ReadonlySet<string>;
}

export interface VisibilityRow {
  kind: 'league' | 'club';
  id: string;
  visibility?: string | null;
}

export function orgKey(kind: 'league' | 'club', id: string): string {
  return `${kind}:${id}`;
}

/** True when this viewer may see the org on this profile. */
export function canViewerSeeOrg(org: VisibilityRow, input: ViewerOrgFilterInput): boolean {
  if (input.isSelfOrGuardian) return true;
  if (org.visibility !== 'private') return true;
  return input.viewerOrgKeys.has(orgKey(org.kind, org.id));
}

export function filterOrgsForViewer<T extends VisibilityRow>(orgs: readonly T[], input: ViewerOrgFilterInput): T[] {
  return orgs.filter(o => canViewerSeeOrg(o, input));
}
