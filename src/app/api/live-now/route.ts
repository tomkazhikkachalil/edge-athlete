import { NextRequest, NextResponse } from 'next/server';
import { GET as golfLiveNow } from '@/app/api/golf/live-now/route';
import { GET as eventsLiveNow } from '@/app/api/sport-events/live-now/route';
import { GET as videosLiveNow } from '@/app/api/videos/live-now/route';

// ── GET /api/live-now ─────────────────────────────────────────────────────────
// The Live Now strip's ONE read (performance program, Phase 2 — Nov 2026): the
// live rounds, the live events and the live broadcasts together. The strip
// used to make three calls, one after another, on every feed open — three
// round trips, and right after a deploy three chances to land on a cold
// function. This route answers all three from ONE function invocation by
// calling the three handlers in-process with the same request: their auth,
// limiter and privacy decisions are theirs, byte for byte — this file adds
// no rule. Signed out, the rounds are `[]` (the golf route answers 401) and
// the two public lists still answer. `private, max-age=10` like its parts.
//
// The three routes stay: `?count=1` callers, the pulse's parity spec and the
// e2e suite read them directly.
export async function GET(request: NextRequest) {
  const [rounds, events, videos] = await Promise.all([
    part<{ rounds: unknown[] }>(() => golfLiveNow(request)),
    part<{ events: unknown[] }>(() => eventsLiveNow(request)),
    part<{ videos: unknown[] }>(() => videosLiveNow(request)),
  ]);
  return NextResponse.json(
    { rounds: rounds?.rounds ?? [], events: events?.events ?? [], videos: videos?.videos ?? [] },
    { headers: { 'Cache-Control': 'private, max-age=10' } }
  );
}

/** One part's JSON when it answered 2xx; null for a 401 (signed out), a 429, a 5xx or a thrown error — the strip shows what it can. */
async function part<T>(run: () => Promise<Response>): Promise<T | null> {
  try {
    const res = await run();
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
