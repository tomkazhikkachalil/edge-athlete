// ── N3 (program 10): the announcement archive — the SERVER half ─────────────
// No table: the notification rows are the record (S6). The members' read
// groups every row of the org by announcement_id (guardian copies carry
// it too) — session-gated at the route, private cache. The archive lives
// as long as its last row: a member may delete a bell, and account
// deletion wipes rows by actor — accepted.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { OrgSide } from './authz';
import { groupAnnouncements, type AnnouncementNotificationRow } from './announce';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ANNOUNCE]';
/** Rows read per org: a few announcements × a few hundred members. */
const ROW_CAP = 5000;

export async function readAnnouncementRows(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<{ rows: AnnouncementNotificationRow[]; error: unknown }> {
  const { data, error } = await admin
    .from('notifications')
    .select('title, message, created_at, metadata')
    .contains('metadata', { org: `${side}:${orgId}`, announcement: true })
    .order('created_at', { ascending: false })
    .limit(ROW_CAP);
  return { rows: (data ?? []) as AnnouncementNotificationRow[], error };
}

export async function orgAnnouncementsGET(admin: Admin, side: OrgSide, orgId: string): Promise<NextResponse> {
  const { rows, error } = await readAnnouncementRows(admin, side, orgId);
  if (error) {
    console.error(`${TAG} archive read error:`, error);
    return NextResponse.json({ error: 'Failed to load announcements' }, { status: 500 });
  }
  return NextResponse.json(
    { announcements: groupAnnouncements(rows) },
    { headers: { 'Cache-Control': 'private, no-store' } }
  );
}
