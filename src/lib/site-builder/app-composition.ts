/**
 * The composition the org GET carries — Site Builder phase 10 (Sep 9 2026).
 *
 * SERVER ONLY (imports the zod-backed parsers). Turns the site's stored
 * layout into the plain wire shape the in-app page renders from
 * (`app-layout.ts AppComposition`): the app-capable instances in reading
 * order, pruned to the VIEWER by the one visibility rule (a members-only
 * paragraph never leaves the server for an outsider), with the content
 * tiles RESOLVED (P10-B) to what they show — blocks through the strict page
 * parser, an image through the streamer URL that re-asserts the site's
 * prefix, an embed through the structure-only src builder — so the client
 * never sees raw config and never needs zod. An EMPTY content tile is
 * dropped for everyone but managers (who see the staff line as a door to
 * the editor). Pure over its inputs, node-tested.
 */

import { parsePageBody } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';
import { isVisibleTo, projectLayoutForApp, type AppComposition, type AppInstance, type AppTile, type AppViewer } from './app-layout';
import type { AudienceSite } from './audience';
import { isContentWidgetKey } from './catalog';
import { embedSrc, embedTitle, parseEmbed } from './embeds';
import type { SiteLayout, WidgetInstance } from './layout';

const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** What a content instance shows, or null when it is empty. */
export function resolveTile(w: WidgetInstance, siteId: string): AppTile | null {
  const config = asRecord(w.config);
  switch (w.key) {
    case 'text': {
      const blocks = parsePageBody(config.blocks);
      return blocks.length > 0 ? { kind: 'text', blocks } : null;
    }
    case 'image': {
      const path = typeof config.path === 'string' ? config.path : '';
      const src = path ? orgMediaUrl(siteId, path) : null;
      if (!src) return null;
      const href = typeof config.href === 'string' && /^https:\/\//.test(config.href) ? config.href : null;
      return {
        kind: 'image',
        src,
        alt: typeof config.alt === 'string' ? config.alt : '',
        caption: typeof config.caption === 'string' && config.caption.trim() ? config.caption.trim() : null,
        href,
        width: typeof config.width === 'number' ? config.width : 1200,
        height: typeof config.height === 'number' ? config.height : 675,
      };
    }
    case 'embed': {
      const e = parseEmbed(config.embed);
      return e ? { kind: 'embed', src: embedSrc(e), title: embedTitle(e), provider: e.provider } : null;
    }
    default:
      return null;
  }
}

/** null layout → null composition (the in-app page keeps the registry order).
 *  `site` is the org's CURRENT privacy (H1) — the effective audience is
 *  decided here, never read off the stored instance. */
export function buildAppComposition(layout: SiteLayout | null, siteId: string, viewer: AppViewer, site: AudienceSite): AppComposition | null {
  if (!layout) return null;
  const byId = new Map(layout.widgets.map(w => [w.id, w]));
  const widgets: AppInstance[] = [];
  for (const inst of projectLayoutForApp(layout, site)) {
    if (!isVisibleTo(inst, viewer)) continue;
    if (!isContentWidgetKey(inst.key)) {
      widgets.push(inst);
      continue;
    }
    const source = byId.get(inst.id);
    const tile = source ? resolveTile(source, siteId) : null;
    // Empty content never renders publicly; managers keep the tile as a door.
    if (!tile && !viewer.canManage) continue;
    widgets.push(tile ? { ...inst, tile } : inst);
  }
  return { widgets };
}
