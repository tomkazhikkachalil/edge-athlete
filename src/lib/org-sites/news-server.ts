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
import { newsState, promoteDraft, publishedAtFor, routeEdit, sameInstant, type NewsEdit } from './news-state';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[ORG SITE NEWS]';
const NEWS_FIELDS = 'id, site_id, slug, title, body, published_at, created_at, updated_at, audience';
// Program 3, D4 (189): the pin; pre-189 databases step down to NEWS_FIELDS.
const NEWS_FIELDS_189 = `${NEWS_FIELDS}, pinned_at`;
const PIN_NEEDS_189 = 'Pinning needs migration 189 — run it, then try again';
// Sports-team website program, N3 (243): the newsroom columns; every read
// steps down 243 → 189 → base on 42703, a write naming a 243 column says so.
const NEWS_FIELDS_243 = `${NEWS_FIELDS_189}, summary, cover_path, team_id, division_id, notify_members, notified_at, banner_until, source_ref, draft, created_by`;
export const NEWS_NEEDS_243 = 'The newsroom needs a database update (migration 243) — ask your admin';
const NEWS_243_COLUMNS = ['summary', 'cover_path', 'team_id', 'division_id', 'notify_members', 'notified_at', 'banner_until', 'source_ref', 'draft', 'created_by'];

type QueryResult = { data: unknown; error: { code?: string; message?: string } | null };
/** Try the widest field list first; a missing column steps down. */
async function readLadder(run: (fields: string) => PromiseLike<QueryResult>): Promise<QueryResult> {
  let res = await run(NEWS_FIELDS_243);
  if (res.error?.code === '42703') res = await run(NEWS_FIELDS_189);
  if (res.error?.code === '42703') res = await run(NEWS_FIELDS);
  return res;
}

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
  const { data, error } = await readLadder(list);
  if (error) {
    if (isMissingTableError(error.code ?? '')) return NextResponse.json({ posts: [] });
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
  input: NewsCreateInput,
  actorId?: string
): Promise<NextResponse> {
  const site = await getSiteForOrg(admin, side, orgId);
  if (!site) {
    return NextResponse.json({ error: 'Site not found' }, { status: 404 });
  }
  // N3 (243): the author — dropped on a database without the column.
  const insertPost = async (slug: string) => {
    const row = { site_id: site.id, slug, title: input.title, ...(actorId ? { created_by: actorId } : {}) };
    let res = await admin.from('org_site_news').insert(row).select(NEWS_FIELDS).single();
    if (actorId && (res.error?.code === 'PGRST204' || res.error?.code === '42703')) {
      res = await admin.from('org_site_news').insert({ site_id: site.id, slug, title: input.title }).select(NEWS_FIELDS).single();
    }
    return res;
  };
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
    const { data: post, error } = await insertPost(input.slug);
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
    const { data: post, error } = await insertPost(candidate);
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
  const { data: post } = await readLadder(one);
  if (!post) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ post, state: newsState((post as { published_at?: string | null }).published_at, Date.now()) });
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
  const nowMs = Date.now();

  // The cross-site image guard (the pagePATCH recipe) — over every body the
  // PATCH can write: the legacy body, the edit's body, and the cover.
  const ownAsset = (path: string) => path.startsWith(`${ORG_MEDIA_PREFIX}${site.id}/`);
  const bodies = [input.body, input.edit?.body].filter((b): b is NonNullable<typeof b> => Array.isArray(b));
  for (const body of bodies) {
    for (const block of body) {
      if (block.type === 'image' && !ownAsset(block.path)) {
        return NextResponse.json({ error: 'Image is not one of this site’s assets' }, { status: 400 });
      }
    }
  }
  if (input.edit?.coverPath && !ownAsset(input.edit.coverPath)) {
    return NextResponse.json({ error: 'The cover is not one of this site’s images' }, { status: 400 });
  }
  // A tag names THIS org's team or division — never another org's.
  if (input.edit?.teamId) {
    const { data: team } = await admin.from('teams').select('id').eq('id', input.edit.teamId).eq(ORG_ID, orgId).maybeSingle();
    if (!team) return NextResponse.json({ error: 'That team is not one of yours' }, { status: 400 });
  }
  if (input.edit?.divisionId) {
    const { data: division } = await admin.from('divisions').select('id').eq('id', input.edit.divisionId).eq(ORG_ID, orgId).maybeSingle();
    if (!division) return NextResponse.json({ error: 'That division is not one of yours' }, { status: 400 });
  }

  // N3: the newsroom acts read the row first (its state, its draft, its
  // updated_at for the compare-and-set). Pre-243 they answer by name.
  const uses243 = input.edit !== undefined || input.publishAt !== undefined || input.promote === true;
  const needsCurrent = uses243 || input.publish !== undefined || input.expectUpdatedAt !== undefined;
  type CurrentRow = { published_at: string | null; updated_at: string; draft?: unknown };
  let current: CurrentRow | null = null;
  if (needsCurrent) {
    const read = (fields: string) => admin.from('org_site_news').select(fields).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null).maybeSingle();
    let res = await read('published_at, updated_at, draft');
    if (res.error?.code === '42703') {
      if (uses243) return NextResponse.json({ error: NEWS_NEEDS_243, code: 'needs_243' }, { status: 400 });
      res = await read('published_at, updated_at');
    }
    current = (res.data as CurrentRow | null) ?? null;
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (input.expectUpdatedAt && !sameInstant(current.updated_at, input.expectUpdatedAt)) {
      const { data: latest } = await readLadder(fields => admin.from('org_site_news').select(fields).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null).maybeSingle());
      return NextResponse.json({ error: 'This post changed somewhere else — the latest is loaded.', code: 'conflict', post: latest }, { status: 409 });
    }
  }
  const state = newsState(current?.published_at, nowMs);

  const patch: Record<string, unknown> = {
    ...(input.title !== undefined ? { title: input.title } : {}),
    ...(input.body !== undefined ? { body: input.body } : {}),
    ...(input.audience !== undefined ? { audience: input.audience } : {}),
    // D4: the pin — a timestamp (newest pin first) or NULL.
    ...(input.pinned !== undefined ? { pinned_at: input.pinned ? new Date(nowMs).toISOString() : null } : {}),
  };
  // N3: an edit lands in the columns (unpublished) or the draft (live);
  // "Update" promotes the draft; the draft's images pass the same guard.
  if (input.edit) Object.assign(patch, routeEdit(state, input.edit as NewsEdit, current?.draft));
  if (input.promote) {
    const promoted = promoteDraft(current?.draft);
    const body = promoted.body;
    if (Array.isArray(body) && body.some(b => b && typeof b === 'object' && (b as { type?: string }).type === 'image' && !ownAsset(String((b as { path?: unknown }).path ?? '')))) {
      return NextResponse.json({ error: 'Image is not one of this site’s assets' }, { status: 400 });
    }
    Object.assign(patch, promoted);
  }
  // Publishing: now, or at a time (future = scheduled, N1's fence); a live
  // post keeps its date; unpublish clears it.
  if (input.publish === true || input.publishAt !== undefined) {
    const at = publishedAtFor(input.publishAt ? { kind: 'at', at: input.publishAt } : { kind: 'now' }, current?.published_at, nowMs);
    if (at) patch.published_at = at;
  } else if (input.publish === false) {
    patch.published_at = null;
  }
  const transition: 'published' | 'scheduled' | null =
    typeof patch.published_at === 'string' ? (Date.parse(patch.published_at) > nowMs ? 'scheduled' : 'published') : null;

  if (Object.keys(patch).length === 0) {
    // Re-publishing an already-published post: nothing to write.
    return newsGET(admin, side, orgId, newsId);
  }
  const write = (fields: string) => {
    let q = admin.from('org_site_news').update(patch).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null);
    // The compare-and-set: the row the editor saw, or nothing.
    if (input.expectUpdatedAt && current) q = q.eq('updated_at', current.updated_at);
    return q.select(fields);
  };
  const names243 = Object.keys(patch).some(k => NEWS_243_COLUMNS.includes(k));
  let { data: updated, error } = await write(NEWS_FIELDS_243);
  // Pre-243 / pre-189: an UPDATE naming a missing column answers PGRST204
  // (the schema cache), a SELECT of one 42703 — say which migration a write
  // needs; anything else still goes through a narrower field list.
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    if (names243) return NextResponse.json({ error: NEWS_NEEDS_243, code: 'needs_243' }, { status: 400 });
    ({ data: updated, error } = await write(NEWS_FIELDS_189));
  }
  if (error?.code === '42703' || error?.code === 'PGRST204') {
    if ('pinned_at' in patch) return NextResponse.json({ error: PIN_NEEDS_189 }, { status: 400 });
    ({ data: updated, error } = await write(NEWS_FIELDS));
  }
  if (error) {
    console.error(`${TAG} patch error:`, error);
    return NextResponse.json({ error: 'Failed to update the post' }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    if (input.expectUpdatedAt) {
      // Lost the race between the read and the write: the same answer as a stale save.
      const { data: latest } = await readLadder(fields => admin.from('org_site_news').select(fields).eq('id', newsId).eq('site_id', site.id).is('deleted_at', null).maybeSingle());
      if (latest) return NextResponse.json({ error: 'This post changed somewhere else — the latest is loaded.', code: 'conflict', post: latest }, { status: 409 });
    }
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  purge(site.subdomain);
  const post = updated[0] as unknown as { published_at?: string | null };
  return NextResponse.json({ post, state: newsState(post.published_at, Date.now()), transition });
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
