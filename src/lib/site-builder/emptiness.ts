import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { parseContact, parseDocuments, parsePageBody, parseSponsors } from '@/lib/org-sites/validate';
import type { WidgetInstance } from './layout';
import { effectiveAudience, type AudienceSite } from './audience';
import { effectiveConfig, type ContentSource } from './config';
import { parseEmbed } from './embeds';
import { selectForInstance } from './select';

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
 * content — decided by `effectiveAudience` at render time (H1), never by
 * the stored visibility alone. The hero and the gallery teaser are never
 * empty.
 */
export function isWidgetEmpty(w: WidgetInstance, raw: SiteHomeData, site: ContentSource & AudienceSite): boolean {
  if (effectiveAudience(site, w) === 'members') return false;
  // Phase 9: the instance's query narrows the bag first — a table bound to
  // a competition with no rows is empty even when another competition has.
  const data = selectForInstance(w, raw);
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
      // Phase 9: a board with nothing on it (or an unsupported sport) is
      // empty too — "empty never renders" applied to the rows, not the list.
      return data.leaders.every(b => b.unsupported || b.stats.every(s => s.rows.length === 0));
    case 'news':
      return (data.news ?? []).length === 0;
    case 'members':
      // H1: the stats reader answers an EMPTY object for an org with no
      // members — "No members yet." must never render publicly.
      return !data.memberStats || data.memberStats.members.length === 0;
    // Phase 6 — content widgets: empty until authored (the instance IS the content).
    case 'text':
      return parsePageBody(config.blocks).length === 0;
    case 'image':
      return typeof config.path !== 'string' || config.path.length === 0;
    case 'embed':
      return parseEmbed(config.embed) === null;
    // Program 2, D: a form is its own content — never empty.
    case 'contact_form':
    case 'interest_form':
      return false;
    default:
      return false;
  }
}
