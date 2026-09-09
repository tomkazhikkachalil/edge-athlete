// The in-app org page's types — shared by the league and club routes since
// R1 of the Org Pages Program (Sep 8 2026) folded the two 980-line page
// twins into one OrgPage. Shapes are byte-for-byte the ones the two pages
// declared inline; the only per-side differences are `sport_key` (league —
// clubs are multi-sport by decision, mig 117) and the legacy free-text
// `location` fallback (club, 001).

import type { OrgBrand } from '@/lib/org-sites/brand-types';

export type OrgSide = 'league' | 'club';

// Phase 5 (mig 161): the widened roster lifecycle. 'pending'/'active' keep
// the invite-flow chips; the four registration statuses get read-only chips
// here (the registration workflow itself lives on the registrar screen).
export type RosterChipStatus =
  | 'pending'
  | 'active'
  | 'registered'
  | 'evaluating'
  | 'placed'
  | 'released';

export const ROSTER_CHIP_LABELS: Record<RosterChipStatus, string> = {
  pending: 'Roster invited',
  active: 'Roster',
  registered: 'Registered',
  evaluating: 'In evaluation',
  placed: 'Placed',
  released: 'Released',
};

interface OrgInfoBase {
  id: string;
  name: string;
  description: string | null;
  owner_profile_id: string | null;
  place_id: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
}

export interface LeagueInfo extends OrgInfoBase {
  sport_key: string;
}

export interface ClubInfo extends OrgInfoBase {
  /** Legacy free-text location (001) — the display fallback. */
  location: string | null;
}

export type OrgInfo = LeagueInfo | ClubInfo;

export interface MemberProfile {
  id: string;
  handle: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

export interface MemberRow {
  profile_id: string;
  role: string;
  joined_at: string;
  profile: MemberProfile | null;
  roster: RosterChipStatus | null;
  /** Phase 4 R4 — managers only (redacted to null otherwise). */
  photoConsent?: boolean | null;
  /** R3: unclaimed roster stub — server-derived, manager-redacted. */
  unclaimed?: boolean;
}

/** The org GET payload. The org itself arrives under its side's key
 *  (`league` | `club`) — OrgPage reads `data[side]`. */
export interface OrgPageResponse {
  /** Phase 7 C4: awaiting approval — only managers/admins ever see the page then. */
  pending?: boolean;
  league?: LeagueInfo;
  club?: ClubInfo;
  /** 0.6b: derived sports (league: division sports ∪ cached primary, cached
   *  first; club: distinct division sports, [] until structure exists). */
  sports?: string[];
  /** Phase 6b A1: the published public site, or null (draft/none). */
  site?: { subdomain: string } | null;
  /** Org Pages R2: the site's brand (draft or published), or null. */
  brand?: OrgBrand | null;
  memberCount: number;
  members: MemberRow[];
  viewerRole: string | null;
  /** Program 11 / Phase 9: the membership settings + the viewer's queued request. */
  visibility?: 'public' | 'private';
  joinPolicy?: 'open' | 'approval';
  viewerRequestPending?: boolean;
  viewerRoster: RosterChipStatus | null;
  /** Phase 5 R3: the Register banner's data (flag-off reads closed/none). */
  viewerRegistration?: {
    windowOpen: boolean;
    current: {
      seasonId: string;
      status: string;
      divisionId: string | null;
      programId: string | null;
      teamName: string | null;
    } | null;
  };
}
