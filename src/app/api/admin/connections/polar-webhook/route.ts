import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { polarConfig, polarCreateWebhook } from '@/lib/activities/providers/polar-server';

/**
 * /api/admin/connections/polar-webhook — the owner's one-time setup step for
 * Polar (fix round part 3, PR 4). Admin-only; the dashboard's "Connected
 * apps" panel is its door.
 *
 * GET  → where things stand: `configured` (client id + secret set),
 *        `signing` (POLAR_WEBHOOK_SECRET set), and the two URLs the owner
 *        needs — the OAuth callback to register in Polar's client, and the
 *        webhook this deployment listens on.
 * POST → create THE webhook at Polar (EXERCISE events to this deployment).
 *        Polar returns the signature key ONCE: it is passed straight to the
 *        owner to put in Vercel as POLAR_WEBHOOK_SECRET — it is never stored
 *        here and never logged.
 */
function urls(request: NextRequest) {
  const origin = new URL(request.url).origin;
  return { callbackUrl: `${origin}/api/connections/polar/callback`, webhookUrl: `${origin}/api/webhooks/polar` };
}

export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const cfg = polarConfig();
    return NextResponse.json({ configured: !!cfg, signing: !!cfg?.webhookSecret, ...urls(request) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[admin/polar-webhook] status error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    await requireAdmin(request);
    const cfg = polarConfig();
    if (!cfg) return NextResponse.json({ error: 'Set POLAR_CLIENT_ID and POLAR_CLIENT_SECRET first.' }, { status: 409 });
    const { webhookUrl } = urls(request);
    const created = await polarCreateWebhook(cfg, webhookUrl);
    if (!created.ok) return NextResponse.json({ error: created.error }, { status: created.status });
    return NextResponse.json(
      { id: created.id, signatureSecretKey: created.signatureSecretKey, webhookUrl },
      { headers: { 'Cache-Control': 'private, no-store' } }
    );
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[admin/polar-webhook] create error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
