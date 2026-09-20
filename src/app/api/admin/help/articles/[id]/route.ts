import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { parseBody } from '@/lib/validation';
import { deleteArticle, HelpNotLive, updateArticle } from '@/lib/help/server';
import { ArticleBody } from '@/lib/help/schema';

/** PATCH / DELETE /api/admin/help/articles/[id] — owner-only. A PATCH is partial; a slug change is allowed (the old URL 404s). */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const user = await requireAdmin(request);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const parsed = await parseBody(request, ArticleBody.partial());
    if (!parsed.success) return parsed.response;
    const outcome = await updateArticle(getSupabaseAdmin(), id, parsed.data, user.id);
    if (!outcome.ok) return NextResponse.json({ error: outcome.error }, { status: outcome.status, headers: NO_STORE });
    return NextResponse.json({ article: outcome.article }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof HelpNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[PATCH /api/admin/help/articles/[id]]', error);
    return NextResponse.json({ error: 'Could not update the article' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireAdmin(request);
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const gone = await deleteArticle(getSupabaseAdmin(), id);
    if (!gone) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof HelpNotLive) return NextResponse.json({ error: error.message }, { status: 503, headers: NO_STORE });
    console.error('[DELETE /api/admin/help/articles/[id]]', error);
    return NextResponse.json({ error: 'Could not delete the article' }, { status: 500, headers: NO_STORE });
  }
}
