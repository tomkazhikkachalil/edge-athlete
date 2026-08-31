// ── team_update senders — org event scheduled / cancelled ───────────────────
// The type sat in notifications_type_check since 117 with no sender (the
// front-loading rule); this module is the sender. Direct admin inserts on
// purpose: create_notification's preference gate has no branch for
// team_update and would silently drop it. Best-effort throughout — a
// notification failure never fails the event write (calendar/notifications
// contract). Membership is uncapped, so inserts are chunked.
//
// ONE notification per member per event — per SERIES for recurring — via a
// metadata marker dedup (golf group-notifications precedent). Titles are
// self-contained: they land verbatim in the email digest.

import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from '@/lib/chunk';
import { memberProfileIds } from '@/lib/orgs/members';
import { scopedMemberProfileIds, type SubOrgScopeType } from '@/lib/orgs/scoped-members';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const NOTIFY_CHUNK = 500;

export interface OrgNotificationTemplate {
  title: string;
  message: string | null;
  actorId: string;
  actionUrl: string;
  metadata: Record<string, unknown>;
}

export interface OrgNotificationRow {
  user_id: string;
  type: 'team_update';
  actor_id: string;
  title: string;
  message: string | null;
  action_url: string;
  is_read: false;
  metadata: Record<string, unknown>;
}

/** Pure: dedupe member ids, drop exclusions, shape rows. */
export function buildOrgEventNotificationRows(
  memberIds: string[],
  exclude: ReadonlySet<string>,
  template: OrgNotificationTemplate
): OrgNotificationRow[] {
  return [...new Set(memberIds)]
    .filter(id => !!id && !exclude.has(id))
    .map(id => ({
      user_id: id,
      type: 'team_update' as const,
      actor_id: template.actorId,
      title: template.title,
      message: template.message,
      action_url: template.actionUrl,
      is_read: false as const,
      metadata: template.metadata,
    }));
}

export interface OrgEventNotifyInput {
  supabase: Admin;
  side: 'league' | 'club';
  orgId: string;
  /** Sub-org scope (146): present → the fan-out enumerates the SCOPED
   *  members only, never the whole org (strict audience — a house-league
   *  game bells its division, not every follower). */
  scope?: { scopeType: SubOrgScopeType; scopeId: string };
  orgName: string;
  /** Anchor occurrence — the deep-link target (`/calendar?event=`). */
  eventId: string;
  /** Present → one notification covers the whole series. */
  seriesId?: string | null;
  eventTitle: string;
  /** formatEventWhen output; becomes the notification's second line. */
  whenText: string | null;
  organizerId: string;
  /** Additional exclusions beyond the organizer: invited guests on create
   *  (they get event_invite), every guest-row holder on cancel (they got
   *  event_cancelled — or declined their way out). */
  excludeProfileIds?: string[];
}

async function sendOrgEventNotification(
  kind: 'scheduled' | 'cancelled',
  input: OrgEventNotifyInput
): Promise<void> {
  try {
    const { supabase, side, orgId, seriesId } = input;
    // Marker dedup: one send per event — per series when the op covers one.
    const marker = seriesId
      ? { team_event: kind, series_id: seriesId }
      : { team_event: kind, event_id: input.eventId };
    const { data: existing } = await supabase
      .from('notifications')
      .select('id')
      .eq('type', 'team_update')
      .contains('metadata', marker)
      .limit(1);
    if (existing && existing.length > 0) return;

    const { profileIds: memberIds, error: memberError } = input.scope
      ? await scopedMemberProfileIds(supabase, input.scope.scopeType, input.scope.scopeId)
      : await memberProfileIds(supabase, { side, orgId });
    if (memberError) {
      console.error('[ORG EVENT NOTIFY] member fetch failed:', memberError);
      return;
    }

    const title =
      kind === 'cancelled'
        ? `${input.orgName} cancelled: ${input.eventTitle}`
        : seriesId
          ? `${input.orgName} scheduled a recurring event: ${input.eventTitle}`
          : `${input.orgName} scheduled: ${input.eventTitle}`;
    const rows = buildOrgEventNotificationRows(
      memberIds,
      new Set([input.organizerId, ...(input.excludeProfileIds ?? [])]),
      {
        title,
        message: input.whenText,
        actorId: input.organizerId,
        actionUrl: `/calendar?event=${input.eventId}`,
        metadata: {
          event_id: input.eventId,
          ...(seriesId ? { series_id: seriesId } : {}),
          org: `${side}:${orgId}`,
          ...marker,
        },
      }
    );
    for (const batch of chunk(rows, NOTIFY_CHUNK)) {
      const { error } = await supabase.from('notifications').insert(batch);
      if (error) {
        console.error('[ORG EVENT NOTIFY] insert failed:', error);
        return;
      }
    }

    // 0.10 — the direct-bell bypass close, ADDITIVE (Tom's decision): a
    // supervised member keeps their team_update; their guardians ALSO hear
    // (the calendar-invite parallel-notify precedent). Unconditional — a
    // safety behavior, never flag-gated. Rides inside the marker-dedup
    // branch above, so re-runs stay no-ops.
    const belled = rows.map(r => r.user_id);
    if (belled.length > 0) {
      const { data: supervised } = await supabase
        .from('profiles')
        .select('id, first_name, display_name')
        .in('id', belled)
        .eq('supervision_state', 'supervised');
      if (supervised && supervised.length > 0) {
        const { notifyGuardians } = await import('@/lib/guardian-notify');
        for (const child of supervised) {
          const childName =
            (child.first_name as string | null) || (child.display_name as string | null) || 'Your athlete';
          await notifyGuardians(supabase, child.id as string, {
            type: 'calendar_alert',
            title:
              kind === 'cancelled'
                ? `${input.orgName} cancelled an event on ${childName}'s calendar: ${input.eventTitle}`
                : `${input.orgName} scheduled for ${childName}: ${input.eventTitle}`,
            message: input.whenText,
            actionUrl: `/app/guardian/athlete/${child.id}`,
            actorId: input.organizerId,
            metadata: {
              event_id: input.eventId,
              ...(seriesId ? { series_id: seriesId } : {}),
              org: `${side}:${orgId}`,
            },
          });
        }
      }
    }
  } catch (e) {
    console.error('[ORG EVENT NOTIFY] failed:', e);
  }
}

export async function notifyOrgEventScheduled(input: OrgEventNotifyInput): Promise<void> {
  return sendOrgEventNotification('scheduled', input);
}

export async function notifyOrgEventCancelled(input: OrgEventNotifyInput): Promise<void> {
  return sendOrgEventNotification('cancelled', input);
}
