/**
 * What the editor's Publish button does — Site Builder hardening H6 (Sep 9
 * 2026). Two publishes exist: taking the SITE live (the site-level action,
 * `manage_org`, which also promotes a dirty draft) and promoting the DRAFT
 * of a live site (`manage_site`). The editor used to do only the second, so
 * a not-yet-live site could never complete the checklist's last step from
 * the editor. Pure, so the choice and its words are node-tested.
 */

export type PublishTarget = 'site' | 'revisions';

export interface PublishPlan {
  target: PublishTarget;
  /** The CTA's label. */
  cta: string;
  /** The toast on success. */
  success: string;
  /** The fallback when the site-level action is refused (a `manage_site`
   *  staffer): the draft still promotes; the wording says who can go live. */
  forbidden: string | null;
}

export function publishPlan(published: boolean): PublishPlan {
  if (published) return { target: 'revisions', cta: 'Publish changes', success: 'Changes published', forbidden: null };
  return {
    target: 'site',
    cta: 'Publish site',
    success: 'Your site is live — link-only until the listing is approved',
    forbidden: 'Only an owner or manager can take the site live — your changes are saved to the draft.',
  };
}
