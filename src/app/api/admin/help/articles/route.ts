import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { createArticle, HelpNotLive, readAllForAdmin } from '@/lib/help/server';
import { ArticleBody } from '@/lib/help/schema';

/**
 * /api/admin/help/articles — the owner's article list and creation
 * (Support & Reporting, Spec 3). Owner-only (`requireAdmin`): the doc's
 * "Tom can add articles from the admin console without a code change".
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;


export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    return NextResponse.json(await readAllForAdmin(getSupabaseAdmin()), { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[GET /api/admin/help/articles]', error);
    return NextResponse.json({ error: 'Could not load the articles' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireAdmin(request);
    const parsed = await parseBody(request, ArticleBody);
    if (!parsed.success) return parsed.response;
    const b = parsed.data;
    const outcome = await createArticle(getSupabaseAdmin(), { title: b.title, body: b.body, topic: b.topic, video_url: b.video_url ?? null, sort_order: b.sort_order, published: b.published, slug: b.slug }, user.id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
    return NextResponse.json({ article: outcome.article }, { status: 201, headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof HelpNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[POST /api/admin/help/articles]', error);
    return NextResponse.json({ error: 'Could not create the article' }, { status: 500, headers: NO_STORE });
  }
}
