/**
 * The site checklist — Site Builder phase 8 (Sep 9 2026). "A checklist,
 * not a blank page": the doc's one-hour goal, as six steps the editor
 * derives from what it already holds (the site, the layout, the resolved
 * data) — no table, no fetch of its own — in the console's `ChecklistStep`
 * shape (`src/lib/orgs/checklist.ts`). Each step's `href` names what
 * completes it: `#theme` opens the theme panel, `#gallery` the design gallery
 * (phase 11), `#picker` the add-section picker, `#publish` publishes,
 * `#w=<id>` selects a tile. Pure, node-tested.
 */

import type { ChecklistStep } from '@/lib/orgs/checklist';
import { parseHeroConfig, parseThemeTokens } from '@/lib/org-sites/validate';
import type { SiteHomeData } from '@/lib/org-sites/home-data';
import { WIDGETS, isContentWidgetKey } from './catalog';
import type { ContentSource } from './config';
import { isWidgetEmpty } from './emptiness';
import type { LegacySiteShape, SiteLayout } from './layout';
import { isSeedLayout, seedLayout } from './seeds';

export { remainingSteps } from '@/lib/orgs/checklist';

export interface SiteChecklistInput {
  hasAccent: boolean;
  hasHeroImage: boolean;
  hasWelcome: boolean;
  arranged: boolean;
  filled: boolean;
  published: boolean;
  /** The hero instance (the photo and welcome steps select it). */
  heroId: string | null;
  /** The first live section still empty (the fill step selects it). */
  firstEmptyLiveId: string | null;
}

/** What the editor knows → the checklist's inputs. */
export function siteChecklistInput(
  site: ContentSource & LegacySiteShape & { template_id: string; theme_token_set: unknown },
  layout: SiteLayout,
  data: SiteHomeData,
  published: boolean
): SiteChecklistInput {
  const tokens = parseThemeTokens(site.theme_token_set);
  const hero = parseHeroConfig(site.hero_config);
  const heroInstance = layout.widgets.find(w => w.key === 'hero') ?? null;
  const hasText = layout.widgets.some(w => w.key === 'text' && !isWidgetEmpty(w, data, site));
  const live = layout.widgets.filter(w => WIDGETS[w.key].family === 'live');
  const filled = live.some(w => !isWidgetEmpty(w, data, site));
  const hasContentTiles = layout.widgets.some(w => isContentWidgetKey(w.key));
  return {
    hasAccent: !!(tokens.accent || tokens.accentStrong),
    hasHeroImage: !!hero.imagePath,
    hasWelcome: !!(hero.headline && hero.headline.trim()) || hasText,
    arranged: hasContentTiles || !isSeedLayout(layout, seedLayout(site)),
    filled,
    published,
    heroId: heroInstance?.id ?? null,
    firstEmptyLiveId: live.find(w => isWidgetEmpty(w, data, site))?.id ?? null,
  };
}

export function buildSiteChecklistSteps(input: SiteChecklistInput): ChecklistStep[] {
  const heroHref = input.heroId ? `#w=${input.heroId}` : undefined;
  return [
    {
      key: 'colours',
      done: input.hasAccent,
      label: 'Pick your colours',
      hint: 'Your accent runs through the header, the buttons and the links.',
      href: '#theme',
    },
    {
      key: 'photo',
      done: input.hasHeroImage,
      label: 'Add a welcome photo',
      hint: 'A photo under the headline is what makes the page yours.',
      href: heroHref,
    },
    {
      key: 'welcome',
      done: input.hasWelcome,
      label: 'Write a welcome',
      hint: 'A headline on the welcome, or a Text section with a few words.',
      href: heroHref,
    },
    {
      key: 'arrange',
      done: input.arranged,
      label: 'Arrange your sections',
      hint: 'Start from a design, or drag a section, resize it, add one — the starting layout is only a start.',
      href: '#gallery',
    },
    {
      key: 'fill',
      done: input.filled,
      label: 'Fill a live section',
      hint: 'Standings, a schedule, teams or news — they fill themselves from the console.',
      href: input.firstEmptyLiveId ? `#w=${input.firstEmptyLiveId}` : undefined,
      optional: true,
    },
    {
      key: 'publish',
      done: input.published,
      label: 'Publish your site',
      hint: 'Preview, then publish — it is link-only until you are listed.',
      href: '#publish',
    },
  ];
}
