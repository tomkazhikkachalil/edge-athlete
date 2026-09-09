import type { OrgEvent } from '@/lib/calendar/org-events-server';
import type { PublicStandingsPayload } from '@/lib/competitions/public-standings';
import type { CourseStats } from '@/lib/golf/course-stats';
import type { MemberStats } from '@/lib/golf/member-stats';
import type {
  PublicAffiliation,
  PublicClubGolfBoard,
  PublicCourse,
  PublicDivision,
  PublicGolfRound,
  PublicLeaderBoard,
  PublicNewsItem,
  PublicOpenWindow,
  PublicStaffRow,
  PublicTeam,
  PublicVenue,
} from '@/lib/org-sites/public-data';

/**
 * The data bag the site home renders from — Site Builder P3-A (Sep 9 2026)
 * moved it here from `SiteHomeBody.tsx` so the resolver (`widget-data.ts`)
 * and the props-only renderer share one type without the renderer importing
 * anything that reads data (guardrail §4b). Every field is the output of one
 * public-data reader; `widget-data.ts` decides which run for a given layout.
 */
export interface SiteHomeData {
  standings: PublicStandingsPayload | null;
  events: OrgEvent[] | null;
  teams: PublicTeam[];
  staff: PublicStaffRow[];
  venues: PublicVenue[];
  affiliations: PublicAffiliation[];
  /** Phase 5 R5 — open registration windows (empty = card says closed). */
  openWindows: PublicOpenWindow[];
  /** Phase 6b A2 — the golf club's linked catalog courses. */
  courses: PublicCourse[];
  /** Phase 6b B3 — divisions + stat leaders (documents ride module config). */
  divisions: PublicDivision[];
  leaders: PublicLeaderBoard[];
  /** Phase 6c G3 — a CLUB page's golf boards (own + affiliated leagues'). */
  clubGolfBoards?: PublicClubGolfBoard[];
  /** Phase 6e S3 — the club's courses fill themselves from members' public rounds. */
  courseStrip?: CourseStats | null;
  /** Phase 6e S4 — a golf league's play windows on the schedule. */
  golfRounds?: PublicGolfRound[];
  /** N1 (program 10) — the latest posts for the home's news teaser
   *  (already audience-filtered for a private club). */
  news?: PublicNewsItem[];
  /** R5: the members table — null when the module is off. */
  memberStats?: MemberStats | null;
}
