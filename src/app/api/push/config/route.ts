import { NextResponse } from 'next/server';
import { vapidConfig } from '@/lib/push/config-server';

// ── GET /api/push/config (mig 248) ──────────────────────────────────────────
// Whether this deployment can send phone notifications, and the public key a
// device subscribes against. The public key is public by design (every
// subscribing browser holds it); answering it here instead of inlining it at
// build time means a key rotation needs no rebuild. No keys → enabled false,
// and the app offers no switch.
export const dynamic = 'force-dynamic';

export async function GET() {
  const config = vapidConfig();
  return NextResponse.json(
    config ? { enabled: true, publicKey: config.publicKey } : { enabled: false, publicKey: null },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
