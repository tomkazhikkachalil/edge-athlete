import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { parseContact, parseDocuments, parseSponsors } from '@/lib/org-sites/validate';
import type { WidgetInstance } from './layout';
import { effectiveConfig, type ContentSource } from './config';

/**
 * "Empty widgets never render publicly" — Site Builder P3-C (Sep 9 2026).
 *
 * The design doc's rule, applied at the framework level so it cannot
 * regress: a visitor never sees "No teams yet." — the tile is simply not
 * there, and the grid re-compacts around it. Staff still see the empty
 * state INSIDE the editor canvas (WidgetBody's quiet lines + the console
 * links), where it is an affordance rather than a hole.
 *
 * Pure, per widget, from the resolved data + the EFFECTIVE config (content
 * from the org objects over the instance's options). A
 * members-only tile on a private club is NOT empty: its panel is the
 * content. The hero and the gallery teaser are never empty.
 */
export function isWidgetEmpty(w: WidgetInstance, data: SiteHomeData, site: ContentSource): boolean {
  if (w.visibility === 'members') return false;
  const config = effectiveConfig(site, w);
  switch (w.key) {
    case 'hero':
    case 'gallery':
      return false;
    case 'standings':
      return !data.standings?.competitions.some(c => c.rows.length > 0 || c.golf);
    case 'schedule':
      return !(data.events && data.events.length > 0) && (data.golfRounds ?? []).length === 0;
    case 'teams':
      return data.teams.length === 0;
    case 'staff':
      return data.staff.length === 0;
    case 'venues':
      return data.venues.length === 0;
    case 'affiliations':
      return data.affiliations.length === 0;
    case 'sponsors':
      return parseSponsors(config).length === 0;
    case 'documents':
      return parseDocuments(config).length === 0;
    case 'contact':
      return Object.keys(parseContact(config)).length === 0;
    case 'register':
      return data.openWindows.length === 0;
    case 'courses':
      return (
        data.courses.length === 0 &&
        !(data.courseStrip && data.courseStrip.roundsPosted > 0) &&
        (data.clubGolfBoards ?? []).length === 0
      );
    case 'divisions':
      return data.divisions.length === 0;
    case 'leaders':
      return data.leaders.length === 0;
    case 'news':
      return (data.news ?? []).length === 0;
    case 'members':
      return !data.memberStats;
    default:
      return false;
  }
}
