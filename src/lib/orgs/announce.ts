// ── Announcements (phase 6e S6) — the PURE half ─────────────────────────────
// A manager writes a short notice ("Rain-out: Week 3 extended to Sunday")
// and every member hears it: a bell per member (the org's own
// `league_update` / `club_update` type — in the CHECK since 028, a sender
// at last), optionally mirrored to the site's notice band (S1) until a
// date. No table: the notification rows ARE the record, grouped by
// `metadata.announcement_id`. Self-contained titles — they land verbatim
// in the email digest. Node-tested.

import { z } from 'zod';
import type { OrgSide } from './authz';

export const ANNOUNCE_TITLE_MAX = 80;
export const ANNOUNCE_MESSAGE_MAX = 500;

export const OrgAnnounceSchema = z.object({
  title: z.string().trim().min(1).max(ANNOUNCE_TITLE_MAX),
  message: z.string().trim().min(1).max(ANNOUNCE_MESSAGE_MAX),
  /** Also show on the public site's notice band through this day (YYYY-MM-DD). */
  siteNoticeUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD').optional(),
});
export type OrgAnnounceInput = z.infer<typeof OrgAnnounceSchema>;

export interface AnnouncementContext {
  side: OrgSide;
  orgId: string;
  orgName: string;
  title: string;
  message: string;
  actorId: string;
  announcementId: string;
  /** P6: extra keys merged into every row's metadata (a dedupe handle
   *  for a generated announcement, e.g. season_competition_id). */
  extraMetadata?: Record<string, string>;
}

export interface AnnouncementRow {
  user_id: string;
  type: 'league_update' | 'club_update';
  actor_id: string;
  title: string;
  message: string;
  action_url: string;
  is_read: false;
  metadata: { org: string; announcement_id: string; announcement: true } & Record<string, string | true>;
}

export function announcementType(side: OrgSide): AnnouncementRow['type'] {
  return side === 'league' ? 'league_update' : 'club_update';
}

export function announcementTitle(orgName: string, title: string): string {
  return `${orgName}: ${title}`;
}

/** One row per member, the actor excluded (a manager needs no self-bell),
 *  duplicates collapsed. */
export function buildAnnouncementRows(
  memberIds: string[],
  ctx: AnnouncementContext
): AnnouncementRow[] {
  const seen = new Set<string>();
  const rows: AnnouncementRow[] = [];
  for (const userId of memberIds) {
    if (!userId || userId === ctx.actorId || seen.has(userId)) continue;
    seen.add(userId);
    rows.push({
      user_id: userId,
      type: announcementType(ctx.side),
      actor_id: ctx.actorId,
      title: announcementTitle(ctx.orgName, ctx.title),
      message: ctx.message,
      action_url: `/${ctx.side}/${ctx.orgId}`,
      is_read: false,
      metadata: {
        ...(ctx.extraMetadata ?? {}),
        org: `${ctx.side}:${ctx.orgId}`,
        announcement_id: ctx.announcementId,
        announcement: true,
      },
    });
  }
  return rows;
}
