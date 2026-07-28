import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { generateFeedToken, hashFeedToken } from '@/lib/calendar/feed-server';

// ── /api/calendar/feed-token ──────────────────────────────────────────────────
// GET  → whether the caller has a feed link (never the raw token — it is
//        unrecoverable by design; regenerate instead).
// POST → create-or-rotate: mints a fresh token, stores only its hash, and
//        returns the full feed URL ONCE. Rotating invalidates the old link.

export async function GET(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const { data } = await getSupabaseAdmin()
      .from('calendar_feed_tokens')
      .select('created_at, rotated_at')
      .eq('profile_id', user.id)
      .maybeSingle();
    return NextResponse.json({
      exists: !!data,
      created_at: data?.created_at ?? null,
      rotated_at: data?.rotated_at ?? null,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] feed-token status error:', error);
    return NextResponse.json({ error: 'Could not load your sync settings' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const rawToken = generateFeedToken();

    const { data: existing } = await admin
      .from('calendar_feed_tokens')
      .select('profile_id')
      .eq('profile_id', user.id)
      .maybeSingle();

    const { error } = await admin.from('calendar_feed_tokens').upsert(
      {
        profile_id: user.id,
        token_hash: hashFeedToken(rawToken),
        ...(existing ? { rotated_at: new Date().toISOString() } : {}),
      },
      { onConflict: 'profile_id' }
    );
    if (error) {
      console.error('[CALENDAR] feed-token upsert failed:', error);
      return NextResponse.json({ error: 'Could not create your link. Please try again.' }, { status: 500 });
    }

    const appUrl =
      process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin;
    return NextResponse.json({
      url: `${appUrl}/api/calendar/feed/${rawToken}`,
      rotated: !!existing,
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('[CALENDAR] feed-token create error:', error);
    return NextResponse.json({ error: 'An unexpected error occurred' }, { status: 500 });
  }
}
