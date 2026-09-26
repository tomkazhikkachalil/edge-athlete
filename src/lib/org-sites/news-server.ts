// ── Org site news CRUD — the shared core (phase 3.5, mig 156) ──────────────
// The pages-server recipe for org_site_news. published_at IS the state:
// NULL = draft, SET = live and the feed order. Publish stamps it ONCE
// (re-publish keeps the original date — news is date-ordered history);
// unpublish nulls it. Slugs mint from the title against the shared
// reserved denylist. Every write revalidateTags the slug tag AND the
// sitemap tag (published posts are crawlable URLs). Pre-156 databases
// degrade: reads answer empty, creates answer a friendly error.

import { revalidateTag } from 'next/cache';
import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';

import { ORG_ID, type OrgKind } from '@/lib/orgs/org-ref';
import {
  isMissingTableError,
  isValidPageSlug,
  NEWS_PER_SITE_MAX,
  slugifyPageTitle,
  type NewsCreateInput,
  type NewsPatchInput,
} from './validate';
import { ORG_MEDIA_PREFIX } from './pages-server';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE NEWS]';
const NEWS_FIELDS = 'id, site_id, slug, title, body, published_at, created_at, updated_at, audience';
// Program 3, D4 (189): the pin; pre-189 databases step down to NEWS_FIELDS.
const NEWS_FIELDS_189 = `${NEWS_FIELDS}, pinned_at`;
const PIN_NEEDS_189 = 'Pinning needs migration 189 — run it, then try again';

async function getSiteForOrg(admin: Admin, side: OrgKind, orgId: string) {
  const { data } = await admin
    .from('org_sites')
    .select('id, subdomain')
    .eq(ORG_ID, orgId)
    .maybeSingle();
  return data as { id: string; subdomain: string } | null;
}

/** Authority (240): how long a deleted news post can be put back. */
export const NEWS_RESTORE_DAYS = 30;

function purge(subdomain: string) {
  revalidateTag(`org-site:${subdomain}`, { expire: 0 });
  revalidateTag('org-sitemap', { expire: 0 });
}

export async function newsListGET(
  admin: Admin,
  side: OrgKind,
  orgId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ posts: [] });
  const list = (fields: string) =>
    admin.from('org_site_news').select(fields).eq('site_id', site.id).is('deleted_at', null).order('created_at', { ascending: false }).limit(NEWS_PER_SITE_MAX + 5);
  let { data, error } = await list(NEWS_FIELDS_189);
  if (error?.code === '42703') ({ data, error } = await list(NEWS_FIELDS));
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ posts: [] });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load news' }, { status: 500 });
  }
  // Authority (240): "Recently deleted" — restorable for NEWS_RESTORE_DAYS, then the daily cron purges.
  const since = new Date(Date.now() - NEWS_RESTORE_DAYS * 86_400_000).toISOString();
  const { data: deleted } = await admin.from('org_site_news').select('id, slug, title, deleted_at').eq('site_id', site.id).not('deleted_at', 'is', null).gte('deleted_at', since).order('deleted_at', { ascending: false }).limit(50);
  return NextResponse.json({ posts: data ?? [], deleted: deleted ?? [] });
}

export async function newsCreatePOST(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  input: NewsCreateInput
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  const { count, error: countError } = await admin
    .from('org_site_news')
    .select('id', { count: 'exact', head: true })
    .eq('site_id', site.id)
    .is('deleted_at', null);
  if (countError && isMissingTableError(countError.code)) {
    return NextResponse.json(
      { error: 'News needs a database update (migration 156) — ask your admin' },
      { status: 400 }
    );
  }
  if ((count ?? 0) >= NEWS_PER_SITE_MAX) {
    return NextResponse.json(
      { error: `A site can have at most ${NEWS_PER_SITE_MAX} news posts` },
      { status: 400 }
    );
  }

  if (input.slug !== undefined) {
    if (!isValidPageSlug(input.slug)) {
      return NextResponse.json(
        { error: 'That address is reserved or invalid' },
        { status: 400 }
      );
    }
    const { data: post, error } = await admin
      .from('org_site_news')
      .insert({ site_id: site.id, slug: input.slug, title: input.title })
      .select(NEWS_FIELDS)
      .single();
    if (error || !post) {
      if (error?.code === '23505') {
        return NextResponse.json({ error: 'That address is already in use' }, { status: 409 });
      }
      console.error(`${TAG} create error:`, error);
      return NextResponse.json({ error: 'Failed to create the post' }, { status: 500 });
    }
    purge(site.subdomain);
    return NextResponse.json({ post });
  }

  const base = slugifyPageTitle(input.title) || 'post';
  const candidates = [base, ...Array.from({ length: 19 }, (_, i) => `${base}-${i + 2}`)]
    .map(c => c.slice(0, 80))
    .filter(isValidPageSlug);
  for (const candidate of candidates) {
    const { data: post, error } = await admin
      .from('org_site_news')
      .insert({ site_id: site.id, slug: candidate, title: input.title })
      .select(NEWS_FIELDS)
      .single();
    if (post) {
      purge(site.subdomain);
      return NextResponse.json({ post });
    }
    if (error?.code !== '23505') {
      console.error(`${TAG} create error:`, error);
      return NextResponse.json({ error: 'Failed to create the post' }, { status: 500 });
    }
  }
  return NextResponse.json(
    { error: 'Could not derive a free address from that title' },
    { status: 409 }
  );
}

export async function newsGET(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  newsId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const one = (fields: string) => admin.from('org_site_news').select(fields).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null).maybeSingle();
  let { data: post, error } = await one(NEWS_FIELDS_189);
  if (error?.code === '42703') ({ data: post, error } = await one(NEWS_FIELDS));
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post });
}

export async function newsPATCH(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  newsId: string,
  input: NewsPatchInput
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  if (input.body) {
    // The cross-site image guard (the pagePATCH recipe).
    for (const block of input.body) {
      if (block.type === 'image' && !block.path.startsWith(`${ORG_MEDIA_PREFIX}${site.id}/`)) {
        return NextResponse.json(
          { error: 'Image is not one of this site’s assets' },
          { status: 400 }
        );
      }
    }
  }

  const patch: Record<string, unknown> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
    // D4: the pin — a timestamp (newest pin first) or NULL.
    ...(input.pinned !== undefined ? { pinned_at: input.pinned ? new Date().toISOString() : null } : {}),
  };
  if (input.publish !== undefined) {
    if (input.publish) {
      // Stamp once — re-publishing keeps the original feed date.
      const { data: current } = await admin
        .from('org_site_news')
        .select('published_at')
        .eq('id', newsId)
        .eq('site_id', site.id)
        .is('deleted_at', null)
        .maybeSingle();
      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
      if (!current.published_at) patch.published_at = new Date().toISOString();
    } else {
      patch.published_at = null;
    }
  }

  if (Object.keys(patch).length === 0) {
    // Re-publishing an already-published post: nothing to write.
    return newsGET(admin, side, orgId, newsId);
  }
  const write = (fields: string) => admin.from('org_site_news').update(patch).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null).select(fields);
  let { data: updated, error } = await write(NEWS_FIELDS_189);
  // Pre-189: an UPDATE naming the missing column answers PGRST204 (the
  // schema cache), a SELECT of it 42703 — the pin cannot be written: say
  // so; anything else still can, through the base field list.
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    if ('pinned_at' in patch) return NextResponse.json({ error: PIN_NEEDS_189 }, { status: 400 });
    ({ data: updated, error } = await write(NEWS_FIELDS));
  }
  if (error) {
    console.error(`${TAG} patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the post' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  purge(site.subdomain);
  return NextResponse.json({ post: updated[0] });
}

/**
 * Authority (240): a delete is SOFT — `deleted_at` / `deleted_by` — so a
 * vandal's deletes can be put back (the owner's "Recently deleted", the
 * team's recovery panel). Every reader skips deleted rows; the daily cron
 * purges them after NEWS_RESTORE_DAYS.
 */
export async function newsDELETE(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  newsId: string,
  actorId: string | null = null
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data, error } = await admin
    .from('org_site_news')
    .update({ deleted_at: new Date().toISOString(), deleted_by: actorId })
    .eq('id', newsId)
    .eq('site_id', site.id)
    .is('deleted_at', null)
    .select('id');
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the post' }, { status: 500 });
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  purge(site.subdomain);
  return NextResponse.json({ success: true });
}

/** Put a soft-deleted post back exactly as it was (published or draft). */
export async function newsRESTORE(
  admin: Admin,
  side: OrgKind,
  orgId: string,
  newsId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data, error } = await admin
    .from('org_site_news')
    .update({ deleted_at: null, deleted_by: null })
    .eq('id', newsId)
    .eq('site_id', site.id)
    .not('deleted_at', 'is', null)
    .select('id, slug, title');
  if (error) {
    console.error(`${TAG} restore error:`, error);
    return NextResponse.json({ error: 'Failed to restore the post' }, { status: 500 });
  }
  if (!data || data.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  purge(site.subdomain);
  return NextResponse.json({ restored: data[0] });
}

/** The daily cron's purge: soft-deleted news older than the restore window goes for good. */
export async function purgeDeletedNews(admin: Admin, now = new Date()): Promise<{ ok: boolean; purged: number }> {
  const before = new Date(now.getTime() - NEWS_RESTORE_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin.from('org_site_news').delete().not('deleted_at', 'is', null).lt('deleted_at', before).select('id');
  if (error) {
    if (error.code !== '42703') console.error(`${TAG} purge error:`, error.message);
    return { ok: false, purged: 0 };
  }
  return { ok: true, purged: (data ?? []).length };
}
