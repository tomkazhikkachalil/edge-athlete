/**
 * Who may see a widget instance — Site Builder phase 1 (Sep 9 2026).
 *
 * ONE function merges the instance's own `visibility` with the org-policy
 * gate that already exists for private clubs (`isMembersOnly`: on a PRIVATE
 * club, the modules in MEMBERS_ONLY_MODULE_KEYS render a members-only panel
 * publicly). Every renderer asks this and nothing else, so the two rules can
 * never disagree. `'members'` and `'staff'` instances are for the in-app
 * surface (a later phase); publicly they are dropped — do not "fix" their
 * absence on the site.
 *
 * Hardening H1 (Sep 9 2026): a STORED layout carries the visibility the
 * instance had when it was derived — a floor, never a ceiling. A club that
 * arranged its page while public and later flipped private used to keep
 * serving standings, teams and staff names on the home page (only the
 * subpages re-checked). Every renderer — the public grid, the emptiness
 * rule, the in-app projection — now asks `effectiveAudience` at render
 * time, and `moduleEnabled` keeps a disabled module's tile off the page
 * until the reducer has reconciled the layout (H4).
 */

import { isMembersOnly } from '@/lib/org-sites/private';
import { WIDGETS } from './catalog';
import type { WidgetInstance, WidgetVisibility } from './layout';

export interface AudienceSite {
  visibility: 'public' | 'private';
}

/** The module rows a renderer holds (the published projection, or the
 *  draft snapshot's) — enough to know which module-backed widgets are ON. */
export interface ModuleSite {
  modules: { module_key: string; enabled: boolean }[];
}

/** A module-backed widget renders only while its module is enabled; a
 *  content widget (no module) always passes. The seed already omits
 *  disabled modules; this makes a STORED layout agree with it. */
export function moduleEnabled(site: ModuleSite, key: WidgetInstance['key']): boolean {
  const moduleKey = WIDGETS[key].moduleKey;
  if (!moduleKey) return true;
  return site.modules.some(m => m.module_key === moduleKey && m.enabled);
}

/** The narrowest audience that may see this instance. */
export function effectiveAudience(site: AudienceSite, instance: WidgetInstance): WidgetVisibility {
  if (instance.visibility !== 'public') return instance.visibility;
  const moduleKey = WIDGETS[instance.key].moduleKey;
  if (moduleKey && isMembersOnly(site, moduleKey)) return 'members';
  return 'public';
}
