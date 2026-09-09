/**
 * The composition the org GET carries — Site Builder phase 10 (Sep 9 2026).
 *
 * SERVER ONLY (imports the zod-backed parsers). Turns the site's stored
 * layout into the plain wire shape the in-app page renders from
 * (`app-layout.ts AppComposition`): the app-capable instances in reading
 * order, pruned to the VIEWER by the one visibility rule (a members-only
 * paragraph never leaves the server for an outsider), with content tiles
 * resolved to what they show (P10-B). Pure over its inputs, node-tested.
 */

import { isVisibleTo, projectLayoutForApp, type AppComposition, type AppViewer } from './app-layout';
import type { SiteLayout } from './layout';

/** null layout → null composition (the in-app page keeps the registry order). */
export function buildAppComposition(layout: SiteLayout | null, viewer: AppViewer): AppComposition | null {
  if (!layout) return null;
  const widgets = projectLayoutForApp(layout).filter(inst => isVisibleTo(inst, viewer));
  return { widgets };
}
