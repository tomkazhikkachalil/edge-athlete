/**
 * Help articles — the readers and the ONE writer (Spec 3; migration 224).
 * Server-only, the service role. The PUBLIC read filters `published` and
 * is cached by its route; the admin reads everything. A video link is
 * validated through the site builder's embed parser (YouTube only — never
 * an arbitrary iframe source). Pre-224 (the table not live) every read
 * answers `supported: false`; every write throws `HelpNotLive` → 503 by name.
 */
import type { getSupabaseAdmin } from '@/lib/auth-server';
import { parseEmbedUrl } from '@/lib/site-builder/embeds';
import { excerptOf } from './body';
import { HELP_TOPICS, slugify, type HelpArticle, type HelpTopic, type PublicHelpArticle } from './types';

type Admin = ReturnType<typeof getSupabaseAdmin>;
const TAG = '[help]';
const NOT_LIVE = new Set(['42P01', 'PGRST205']);
const COLUMNS = 'id, slug, title, body, topic, video_url, sort_order, published, created_at, updated_at';

export class HelpNotLive extends Error {
  constructor() {
    super('The Help Center is not available yet.');
    this.name = 'HelpNotLive';
  }
}
const isNotLive = (e: { code?: string } | null | undefined) => !!e?.code && NOT_LIVE.has(e.code);

/** A YouTube video id from a stored link, or null (an invalid link renders no player). */
export function youtubeIdOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const embed = parseEmbedUrl(url);
  return embed && embed.provider === 'youtube' ? embed.id : null;
}

export function toPublic(a: HelpArticle): PublicHelpArticle {
  return { slug: a.slug, title: a.title, topic: a.topic, videoId: youtubeIdOf(a.video_url), excerpt: excerptOf(a.body), updated_at: a.updated_at };
}

export async function readPublished(admin: Admin): Promise<{ supported: boolean; articles: PublicHelpArticle[] }> {
  const { data, error } = await admin.from('help_articles').select(COLUMNS).eq('published', true).order('sort_order').order('title').limit(500);
  if (error) {
    if (isNotLive(error)) return { supported: false, articles: [] };
    console.error(`${TAG} public read failed:`, error.message);
    throw new Error('Could not load the articles');
  }
  return { supported: true, articles: ((data ?? []) as HelpArticle[]).map(toPublic) };
}

export async function readPublishedBySlug(admin: Admin, slug: string): Promise<(PublicHelpArticle & { body: string }) | null> {
  const { data, error } = await admin.from('help_articles').select(COLUMNS).eq('slug', slug).eq('published', true).maybeSingle();
  if (error) {
    if (isNotLive(error)) return null;
    throw new Error('Could not load the article');
  }
  if (!data) return null;
  const a = data as HelpArticle;
  return { ...toPublic(a), body: a.body };
}

export async function readAllForAdmin(admin: Admin): Promise<{ supported: boolean; articles: HelpArticle[] }> {
  const { data, error } = await admin.from('help_articles').select(COLUMNS).order('topic').order('sort_order').order('title').limit(500);
  if (error) {
    if (isNotLive(error)) return { supported: false, articles: [] };
    throw new Error('Could not load the articles');
  }
  return { supported: true, articles: (data ?? []) as HelpArticle[] };
}

export interface ArticleInput {
  title: string;
  body: string;
  topic: HelpTopic;
  video_url: string | null;
  sort_order: number;
  published: boolean;
  slug?: string;
}

export type ArticleWriteOutcome = { ok: true; article: HelpArticle } | { ok: false; status: 400 | 404 | 409; error: string };

function validate(input: Partial<ArticleInput>): string | null {
  if (input.topic !== undefined && !(HELP_TOPICS as readonly string[]).includes(input.topic)) return 'Pick a topic from the list.';
  if (input.video_url && !youtubeIdOf(input.video_url)) return 'The video must be a YouTube link.';
  if (input.slug !== undefined && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)) return 'The slug may hold lowercase letters, digits and single dashes.';
  return null;
}

export async function createArticle(admin: Admin, input: ArticleInput, actorId: string): Promise<ArticleWriteOutcome> {
  const problem = validate(input);
  if (problem) return { ok: false, status: 400, error: problem };
  const slug = input.slug || slugify(input.title);
  if (!slug) return { ok: false, status: 400, error: 'The title needs a letter or a digit for its slug.' };
  const { data, error } = await admin
    .from('help_articles')
    .insert({ slug, title: input.title, body: input.body, topic: input.topic, video_url: input.video_url, sort_order: input.sort_order, published: input.published, created_by: actorId, updated_by: actorId })
    .select(COLUMNS)
    .single();
  if (error || !data) {
    if (isNotLive(error)) throw new HelpNotLive();
    if (error?.code === '23505') return { ok: false, status: 409, error: 'An article with that slug already exists.' };
    console.error(`${TAG} create failed:`, error?.message);
    throw new Error('Could not create the article');
  }
  return { ok: true, article: data as HelpArticle };
}

export async function updateArticle(admin: Admin, id: string, patch: Partial<ArticleInput>, actorId: string): Promise<ArticleWriteOutcome> {
  const problem = validate(patch);
  if (problem) return { ok: false, status: 400, error: problem };
  const update: Record<string, unknown> = { updated_by: actorId };
  for (const k of ['title', 'body', 'topic', 'video_url', 'sort_order', 'published', 'slug'] as const) {
    if (patch[k] !== undefined) update[k] = patch[k];
  }
  const { data, error } = await admin.from('help_articles').update(update).eq('id', id).select(COLUMNS).maybeSingle();
  if (error) {
    if (isNotLive(error)) throw new HelpNotLive();
    if (error.code === '23505') return { ok: false, status: 409, error: 'An article with that slug already exists.' };
    console.error(`${TAG} update failed:`, error.message);
    throw new Error('Could not update the article');
  }
  if (!data) return { ok: false, status: 404, error: 'Not found' };
  return { ok: true, article: data as HelpArticle };
}

export async function deleteArticle(admin: Admin, id: string): Promise<boolean> {
  const { data, error } = await admin.from('help_articles').delete().eq('id', id).select('id');
  if (error) {
    if (isNotLive(error)) throw new HelpNotLive();
    throw new Error('Could not delete the article');
  }
  return (data ?? []).length > 0;
}
