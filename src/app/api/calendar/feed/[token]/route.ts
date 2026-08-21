import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { FEATURE_FLAGS } from '@/lib/features';
import { hashFeedToken, buildFeedIcs } from '@/lib/calendar/feed-server';

// ── GET /api/calendar/feed/[token] ────────────────────────────────────────────
// The subscribe feed. NO cookie auth — Google/Outlook poll this URL on
// their own schedule, so the 256-bit token IS the credential (capability
// URL). Anything but an exact-shape, known-hash token → 404.

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  if (!FEATURE_FLAGS.FEATURE_CALENDAR) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  try {
    const { token } = await params;
    if (!TOKEN_RE.test(token)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const { data: row } = await admin
      .from('calendar_feed_tokens')
      .select('profile_id')
      .eq('token_hash', hashFeedToken(token))
      .maybeSingle();
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Supervised minors (Round F): serve-time check so links minted before
    // the account became supervised — or before this gate existed — go dark
    // too. The token stops resolving; calendar apps just see a dead feed.
    const { data: owner } = await admin
      .from('profiles')
      .select('supervision_state')
      .eq('id', row.profile_id)
      .maybeSingle();
    if (owner?.supervision_state === 'supervised') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ics = await buildFeedIcs(admin, row.profile_id);
    return new NextResponse(ics, {
      status: 200,
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'private, max-age=300',
        'X-Robots-Tag': 'noindex',
      },
    });
  } catch (error) {
    console.error('[CALENDAR] feed error:', error);
    return NextResponse.json({ error: 'Could not build the feed' }, { status: 500 });
  }
}
