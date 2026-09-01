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
import type { OrgSide } from '@/lib/orgs/authz';
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
const NEWS_FIELDS = 'id, site_id, slug, title, body, published_at, created_at, updated_at';

function orgColumn(side: OrgSide): 'league_id' | 'club_id' {
  return side === 'league' ? 'league_id' : 'club_id';
}

async function getSiteForOrg(admin: Admin, side: OrgSide, orgId: string) {
  const { data } = await admin
    .from('org_sites')
    .select('id, subdomain')
    .eq(orgColumn(side), orgId)
    .maybeSingle();
  return data as { id: string; subdomain: string } | null;
}

function purge(subdomain: string) {
  revalidateTag(`org-site:${subdomain}`, { expire: 0 });
  revalidateTag('org-sitemap', { expire: 0 });
}

export async function newsListGET(
  admin: Admin,
  side: OrgSide,
  orgId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ posts: [] });
  const { data, error } = await admin
    .from('org_site_news')
    .select(NEWS_FIELDS)
    .eq('site_id', site.id)
    .order('created_at', { ascending: false })
    .limit(NEWS_PER_SITE_MAX + 5);
  if (error) {
    if (isMissingTableError(error.code)) return NextResponse.json({ posts: [] });
    console.error(`${TAG} list error:`, error);
    return NextResponse.json({ error: 'Failed to load news' }, { status: 500 });
  }
  return NextResponse.json({ posts: data ?? [] });
}

export async function newsCreatePOST(
  admin: Admin,
  side: OrgSide,
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
    .eq('site_id', site.id);
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
  side: OrgSide,
  orgId: string,
  newsId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { data: post } = await admin
    .from('org_site_news')
    .select(NEWS_FIELDS)
    .eq('id', newsId)
    .eq('site_id', site.id)
    .maybeSingle();
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post });
}

export async function newsPATCH(
  admin: Admin,
  side: OrgSide,
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
  };
  if (input.publish !== undefined) {
    if (input.publish) {
      // Stamp once — re-publishing keeps the original feed date.
      const { data: current } = await admin
        .from('org_site_news')
        .select('published_at')
        .eq('id', newsId)
        .eq('site_id', site.id)
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
  const { data: updated, error } = await admin
    .from('org_site_news')
    .update(patch)
    .eq('id', newsId)
    .eq('site_id', site.id)
    .select(NEWS_FIELDS);
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

export async function newsDELETE(
  admin: Admin,
  side: OrgSide,
  orgId: string,
  newsId: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const { error } = await admin
    .from('org_site_news')
    .delete()
    .eq('id', newsId)
    .eq('site_id', site.id);
  if (error) {
    console.error(`${TAG} delete error:`, error);
    return NextResponse.json({ error: 'Failed to delete the post' }, { status: 500 });
  }
  purge(site.subdomain);
  return NextResponse.json({ success: true });
}
