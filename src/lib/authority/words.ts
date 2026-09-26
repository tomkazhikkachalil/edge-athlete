// ── The authority log in words (Authority PR 4) ────────────────────────────
// Zero server imports: the team's recovery panels and (PR 5) the owner's
// Activity section read the same words. Every AUTHORITY_ACTIONS value has
// one — pinned by __tests__/authority-recovery.test.ts.
import type { AuthorityAction } from './types';

export const AUTHORITY_ACTION_WORDS: Record<AuthorityAction, string> = {
  org_created: 'Created the organization',
  owner_added: 'Made an owner',
  owner_removed: 'Removed an owner',
  owner_stepped_down: 'Stepped down as owner',
  owner_claimed: 'Claimed the organization',
  manager_added: 'Made a manager',
  manager_removed: 'Removed a manager',
  staff_granted: 'Granted staff access',
  staff_changed: 'Changed staff access',
  staff_revoked: 'Revoked staff access',
  identity_changed: 'Changed the details',
  listing_changed: 'Changed the directory listing',
  site_created: 'Created the website',
  site_live: 'Took the website live',
  site_offline: 'Took the website offline',
  site_held: 'Paused the website',
  site_released: 'Released the website',
  site_published: 'Published website changes',
  revision_restored: 'Restored a website version',
  revision_labelled: 'Labelled a website version',
  domain_added: 'Added a domain',
  domain_removed: 'Removed a domain',
  news_deleted: 'Deleted a news post',
  news_restored: 'Restored a news post',
  page_removed: 'Removed a page',
  recovery_link_minted: 'Sent a recovery link',
  recovery_link_redeemed: 'Used a recovery link',
  co_organizer_invited: 'Invited a co-organizer',
  co_organizer_added: 'Added a co-organizer',
  co_organizer_removed: 'Removed a co-organizer',
  host_transferred: 'Handed the event over',
  event_details_changed: 'Changed the event details',
  event_cancelled: 'Cancelled the event',
  event_deleted: 'Deleted the event',
  result_hidden: 'Hid an official result from their profile',
  result_unhidden: 'Showed an official result on their profile again',
  result_reassigned: 'Moved a result to the right person',
  result_corrected: 'Corrected a result',
  official_tag_removed: 'Took someone off an official result',
};

export function actionWords(action: string): string {
  return (AUTHORITY_ACTION_WORDS as Record<string, string>)[action] ?? action;
}
