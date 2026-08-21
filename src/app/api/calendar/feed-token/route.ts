import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { generateFeedToken, hashFeedToken } from '@/lib/calendar/feed-server';

// ── /api/calendar/feed-token ──────────────────────────────────────────────────
// GET  → whether the caller has a feed link (never the raw token — it is
//        unrecoverable by design; regenerate instead).
// POST → create-or-rotate: mints a fresh token, stores only its hash, and
//        returns the full feed URL ONCE. Rotating invalidates the old link.
//
// Supervised minors cannot mint one (Round F): the feed URL is an
// UNAUTHENTICATED capability exposing the child's real-world schedule, and
// nothing in the guardian console could see or revoke it. The serve side
// (feed/[token]) also 404s supervised profiles, killing already-minted links.

const SUPERVISED_FEED_MESSAGE =
  "Calendar sync links aren't available on a supervised account.";

async function isSupervised(profileId: string): Promise<boolean> {
  const { data } = await getSupabaseAdmin()
    .from('profiles')
    .select('supervision_state')
    .eq('id', profileId)
    .maybeSingle();
  return data?.supervision_state === 'supervised';
}

export async function GET(request: NextRequest) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const user = await requireAuth(request);
    const admin = getSupabaseAdmin();
    const [{ data }, supervised] = await Promise.all([
      admin
        .from('calendar_feed_tokens')
        .select('created_at, rotated_at')
        .eq('profile_id', user.id)
        .maybeSingle(),
      isSupervised(user.id),
    ]);
    return NextResponse.json({
      exists: !!data,
      created_at: data?.created_at ?? null,
      rotated_at: data?.rotated_at ?? null,
      supervised,
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
    if (await isSupervised(user.id)) {
      return NextResponse.json({ error: SUPERVISED_FEED_MESSAGE }, { status: 403 });
    }
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
