// ── Announcements (phase 6e S6) — the SERVER half ───────────────────────────
// orgAnnouncePOST: every member of the org (roster + follow — the org's
// audience) gets the bell, chunked; a supervised member's guardians ALSO
// hear (the org-event notify precedent — a safety behaviour, never
// flag-gated; nothing here relaxes a rail); optionally the title shows in
// the site's notice band until a date — derived at READ time from these
// rows (org-sites/banner.ts activeBanner, P0-2 Sep 27 2026), never copied
// into hero_config, so a publish can no longer wipe it. Best-
// effort where the charter says so, but the member insert itself is the
// deliverable — a failed insert is a 500, not a silent success.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';

import { ORG_ID, type OrgKind } from './org-ref';
import { memberProfileIds } from './members';
import { chunk } from '@/lib/chunk';
import { notifyGuardians } from '@/lib/guardian-notify';
import { announcementType, buildAnnouncementRows, siteNoticeMetadata, type OrgAnnounceInput } from './announce';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ANNOUNCE]';
const NOTIFY_CHUNK = 500;

export async function orgAnnouncePOST(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  input: OrgAnnounceInput,
  actorId: string,
  opts: { extraMetadata?: Record<string, string> } = {}
): Promise<NextResponse> {
  const { data: org } = await admin
    .from('organizations')
    .select('id, name')
    .eq('id', orgId)
    .maybeSingle();
  if (!org) return NextResponse.json({ error: side === 'league' ? 'League not found' : 'Club not found' }, { status: 404 });

  const { profileIds, error: membersError } = await memberProfileIds(admin, { side, orgId });
  if (membersError) {
    console.error(`${TAG} members read error:`, membersError);
    return NextResponse.json({ error: 'Failed to load members' }, { status: 500 });
  }
  const announcementId = randomUUID();

  // `site_notice` is stamped only when the org HAS a site (the band reads
  // these rows at render — banner.ts). A missing site is a no-op.
  const noticeSite = input.siteNoticeUntil ? await siteForNotice(admin, orgId) : null;
  const siteNotice = !!noticeSite;

  const ctx = {
    side,
    orgId,
    orgName: org.name as string,
    title: input.title,
    message: input.message,
    actorId,
    announcementId,
    ...(opts.extraMetadata ? { extraMetadata: opts.extraMetadata } : {}),
    ...(siteNotice && input.siteNoticeUntil ? { siteNoticeUntil: input.siteNoticeUntil } : {}),
  };
  const rows = buildAnnouncementRows(profileIds, ctx);
  for (const batch of chunk(rows, NOTIFY_CHUNK)) {
    const { error } = await admin.from('notifications').insert(batch);
    if (error) {
      console.error(`${TAG} insert failed:`, error);
      return NextResponse.json({ error: 'Failed to send the announcement' }, { status: 500 });
    }
  }

  // The band + the News page's Notices read the rows just written: purge
  // AFTER the insert, so no render between the two can cache a page without it.
  if (noticeSite) revalidateTag(`org-site:${noticeSite.subdomain}`, { expire: 0 });

  // Guardians of supervised members hear too (best-effort fan-out).
  let guardians = 0;
  try {
    const belled = rows.map(r => r.user_id);
    if (belled.length > 0) {
      const supervised: { id: string; first_name: string | null; display_name: string | null }[] = [];
      for (const batch of chunk(belled, NOTIFY_CHUNK)) {
        const { data } = await admin
          .from('profiles')
          .select('id, first_name, display_name')
          .in('id', batch)
          .eq('supervision_state', 'supervised');
        supervised.push(...((data ?? []) as typeof supervised));
      }
      for (const child of supervised) {
        const childName = child.first_name || child.display_name || 'Your athlete';
        await notifyGuardians(
          admin,
          child.id,
          {
            type: announcementType(side),
            title: `${ctx.orgName} announced for ${childName}: ${input.title}`,
            message: input.message,
            actionUrl: `/app/guardian/athlete/${child.id}`,
            actorId,
            metadata: {
              ...siteNoticeMetadata(ctx.siteNoticeUntil),
              org: `${side}:${orgId}`,
              announcement_id: announcementId,
              announcement: true,
            },
          },
          actorId
        );
        guardians += 1;
      }
    }
  } catch (e) {
    console.error(`${TAG} guardian fan-out failed:`, e);
  }

  return NextResponse.json({ ok: true, announcementId, sent: rows.length, guardians, siteNotice });
}

/** The org's site for the notice band — null when it has none (or the read
 *  fails; never throws). Announce never WRITES org_sites: the band is derived
 *  from the notification rows at render (P0-2). */
async function siteForNotice(admin: Admin, orgId: string): Promise<{ id: string; subdomain: string } | null> {
  try {
    const { data: site } = await admin.from('org_sites').select('id, subdomain').eq(ORG_ID, orgId).maybeSingle();
    return (site as { id: string; subdomain: string } | null) ?? null;
  } catch (e) {
    console.error(`${TAG} site read failed:`, e);
    return null;
  }
}
