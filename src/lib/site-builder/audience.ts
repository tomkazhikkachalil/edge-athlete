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
 */

import { isMembersOnly } from '@/lib/org-sites/private';
import { WIDGETS } from './catalog';
import type { WidgetInstance, WidgetVisibility } from './layout';

export interface AudienceSite {
  visibility: 'public' | 'private';
}

/** The narrowest audience that may see this instance. */
export function effectiveAudience(site: AudienceSite, instance: WidgetInstance): WidgetVisibility {
  if (instance.visibility !== 'public') return instance.visibility;
  const moduleKey = WIDGETS[instance.key].moduleKey;
  if (moduleKey && isMembersOnly(site, moduleKey)) return 'members';
  return 'public';
}
