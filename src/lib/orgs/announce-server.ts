// ── Announcements (phase 6e S6) — the SERVER half ───────────────────────────
// orgAnnouncePOST: every member of the org (roster + follow — the org's
// audience) gets the bell, chunked; a supervised member's guardians ALSO
// hear (the org-event notify precedent — a safety behaviour, never
// flag-gated; nothing here relaxes a rail); optionally the title becomes
// the site's notice band (S1's hero_config, purged) until a date. Best-
// effort where the charter says so, but the member insert itself is the
// deliverable — a failed insert is a 500, not a silent success.

import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { revalidateTag } from 'next/cache';
import type { OrgSide } from './authz';
import { memberProfileIds } from './members';
import { chunk } from '@/lib/chunk';
import { notifyGuardians } from '@/lib/guardian-notify';
import { parseHeroConfig } from '@/lib/org-sites/validate';
import { announcementType, buildAnnouncementRows, type OrgAnnounceInput } from './announce';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ANNOUNCE]';
const NOTIFY_CHUNK = 500;

export async function orgAnnouncePOST(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  input: OrgAnnounceInput,
  actorId: string
): Promise<NextResponse> {
  const { data: org } = await admin
    .from(side === 'league' ? 'leagues' : 'clubs')
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
  const ctx = {
    side,
    orgId,
    orgName: org.name as string,
    title: input.title,
    message: input.message,
    actorId,
    announcementId,
  };
  const rows = buildAnnouncementRows(profileIds, ctx);
  for (const batch of chunk(rows, NOTIFY_CHUNK)) {
    const { error } = await admin.from('notifications').insert(batch);
    if (error) {
      console.error(`${TAG} insert failed:`, error);
      return NextResponse.json({ error: 'Failed to send the announcement' }, { status: 500 });
    }
  }

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
            metadata: { org: `${side}:${orgId}`, announcement_id: announcementId, announcement: true },
          },
          actorId
        );
        guardians += 1;
      }
    }
  } catch (e) {
    console.error(`${TAG} guardian fan-out failed:`, e);
  }

  // Mirror to the site's notice band (S1) — a missing site is a no-op.
  let siteNotice = false;
  if (input.siteNoticeUntil) {
    try {
      const { data: site } = await admin
        .from('org_sites')
        .select('id, subdomain, hero_config')
        .eq(side === 'league' ? 'league_id' : 'club_id', orgId)
        .maybeSingle();
      if (site) {
        const hero = parseHeroConfig(site.hero_config);
        const hero_config = {
          ...((site.hero_config as Record<string, unknown> | null) ?? {}),
          ...(hero.headline ? { headline: hero.headline } : {}),
          notice: input.title.slice(0, 200),
          noticeUntil: input.siteNoticeUntil,
        };
        const { error } = await admin.from('org_sites').update({ hero_config }).eq('id', site.id);
        if (!error) {
          revalidateTag(`org-site:${site.subdomain}`, { expire: 0 });
          siteNotice = true;
        }
      }
    } catch (e) {
      console.error(`${TAG} site notice failed:`, e);
    }
  }

  return NextResponse.json({ ok: true, announcementId, sent: rows.length, guardians, siteNotice });
}
