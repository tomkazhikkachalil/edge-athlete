// A news post's "Notify members" (sports-team website program, A1, Sep 28
// 2026) — the Announce merge: the bells go out ONCE, when the post is live.
//
//   • notifyNewsPost — the ONE sender. It CLAIMS the post first
//     (`notified_at` set only where it is still null, the post live and
//     notify_members on), so a double click, a publish racing the cron, or
//     two tabs can never bell twice; then fans out through Announce's own
//     `fanOutAnnouncement` (members + a supervised member's guardians). A
//     failed member insert UN-stamps the claim, so the next try sends.
//   • runScheduledNewsSweep — the reminders cron's step: posts whose
//     scheduled time has come with notify on and no bells yet.
//
// The bell: the post's title, its summary (else its first paragraph's
// words), and the post's page. `announcement_id` is the post's id, so the
// in-app archive and the NOTIFY_ORG_KEY readers keep working unchanged.

import type { SupabaseClient } from '@supabase/supabase-js';
import { fanOutAnnouncement } from '@/lib/orgs/announce-server';
import { memberProfileIds } from '@/lib/orgs/members';
import { orgKindOf, type OrgKind } from '@/lib/orgs/org-ref';
import { recordAuthority } from '@/lib/authority/audit-server';
import { newsBellMessage } from './news-bell';
import { orgSitePath } from './urls';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[NEWS NOTIFY]';

export type NotifyOutcome = { status: 'sent'; sent: number; guardians: number } | { status: 'skipped' } | { status: 'failed' };

export async function notifyNewsPost(
  admin: Admin,
  input: { side: OrgKind; orgId: string; newsId: string; actorId: string }
): Promise<NotifyOutcome> {
  const nowIso = new Date().toISOString();
  // The claim: only a live, not-yet-notified post with notify on — atomically.
  const { data: claimed, error: claimError } = await admin
    .from('org_site_news')
    .update({ notified_at: nowIso })
    .eq('id', input.newsId)
    .eq('notify_members', true)
    .is('notified_at', null)
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .lte('published_at', nowIso)
    .select('id, site_id, title, slug, summary, body');
  if (claimError) {
    // Pre-243 (no notify columns) or a transient error: nothing is claimed.
    if (claimError.code !== '42703' && claimError.code !== 'PGRST204') console.error(`${TAG} claim error:`, claimError);
    return { status: 'skipped' };
  }
  const post = (claimed as { id: string; site_id: string; title: string; slug: string; summary: string | null; body: unknown }[] | null)?.[0];
  if (!post) return { status: 'skipped' };

  const unclaim = async () => {
    await admin.from('org_site_news').update({ notified_at: null }).eq('id', post.id).is('deleted_at', null);
  };
  const [{ data: org }, { data: site }] = await Promise.all([
    admin.from('organizations').select('id, name').eq('id', input.orgId).maybeSingle(),
    admin.from('org_sites').select('subdomain').eq('id', post.site_id).maybeSingle(),
  ]);
  const { profileIds, error: membersError } = await memberProfileIds(admin, { side: input.side, orgId: input.orgId });
  if (!org || membersError) {
    console.error(`${TAG} org / members read failed:`, membersError);
    await unclaim();
    return { status: 'failed' };
  }
  const orgName = (org as { name: string }).name;
  const subdomain = (site as { subdomain?: string } | null)?.subdomain;
  const out = await fanOutAnnouncement(admin, profileIds, {
    side: input.side,
    orgId: input.orgId,
    orgName,
    title: post.title,
    message: newsBellMessage(post, orgName),
    actorId: input.actorId,
    announcementId: post.id,
    extraMetadata: { news_id: post.id },
    ...(subdomain ? { actionUrl: `${orgSitePath(subdomain)}/news/${post.slug}` } : {}),
  });
  if (!out.ok) {
    await unclaim();
    return { status: 'failed' };
  }
  await recordAuthority(admin, {
    subject: { type: 'org', id: input.orgId },
    actor: { kind: 'member', profileId: input.actorId },
    action: 'news_notified',
    detail: { news_id: post.id, title: post.title, slug: post.slug, status: 'sent', after: out.sent },
  });
  return { status: 'sent', sent: out.sent, guardians: out.guardians };
}

/**
 * The reminders cron's step: every post whose scheduled time has come with
 * notify on and no bells yet (bounded). The actor is the post's author, else
 * an owner of the org. Never throws; returns how many were sent.
 */
export async function runScheduledNewsSweep(admin: Admin, limit = 25): Promise<{ checked: number; sent: number }> {
  const nowIso = new Date().toISOString();
  const { data, error } = await admin
    .from('org_site_news')
    .select('id, site_id, created_by, site:org_sites(org_id, org:organizations(kind))')
    .eq('notify_members', true)
    .is('notified_at', null)
    .is('deleted_at', null)
    .not('published_at', 'is', null)
    .lte('published_at', nowIso)
    .order('published_at', { ascending: true })
    .limit(limit);
  if (error) {
    if (error.code !== '42703' && error.code !== 'PGRST204') console.error(`${TAG} sweep read error:`, error);
    return { checked: 0, sent: 0 };
  }
  let sent = 0;
  for (const row of (data ?? []) as { id: string; created_by: string | null; site: unknown }[]) {
    const site = (Array.isArray(row.site) ? row.site[0] : row.site) as { org_id?: string; org?: unknown } | null;
    const orgId = site?.org_id;
    const side = site ? orgKindOf(site as never) : null;
    if (!orgId || !side) continue;
    let actorId = row.created_by;
    if (!actorId) {
      const { data: owner } = await admin.from('memberships').select('profile_id').eq('org_id', orgId).eq('role', 'owner').limit(1).maybeSingle();
      actorId = (owner as { profile_id?: string } | null)?.profile_id ?? null;
    }
    if (!actorId) continue;
    const out = await notifyNewsPost(admin, { side, orgId, newsId: row.id, actorId });
    if (out.status === 'sent') sent += 1;
  }
  return { checked: (data ?? []).length, sent };
}
