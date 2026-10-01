import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { findProviderConnection, markRevoked, recordDelivery } from '@/lib/activities/connections-server';
import { parsePolarWebhook, verifyPolarSignature } from '@/lib/activities/providers/polar';
import { polarConfig } from '@/lib/activities/providers/polar-server';
import { importPolarExercise } from '@/lib/activities/providers/polar-sync-server';

/**
 * POST /api/webhooks/polar — Polar tells us an athlete finished an exercise
 * (fix round part 3, PR 4). No session: Polar is the caller.
 *
 * THE SIGNATURE IS THE GATE. Every event but the creation PING must carry
 * `Polar-Webhook-Signature` = HMAC-SHA256 of the raw body under the key
 * Polar returned when the webhook was created (POLAR_WEBHOOK_SECRET),
 * compared in constant time. The PING is answered without one because it
 * arrives BEFORE that key exists (it is part of creating the webhook) — and
 * it does nothing. No rate bucket, by design: an unsigned body costs one
 * HMAC and no I/O, less than counting it would.
 *
 * The exercise is fetched from OUR configured Polar base by its id — never
 * from the payload's `url`. A signed event is always answered 200 (Polar
 * deactivates a webhook that keeps failing, and the daily run is the net
 * under anything missed here): unknown athlete → nothing to do; a 401 from
 * Polar on the athlete's token → the connection is marked revoked.
 */
export const maxDuration = 60;

const MAX_BODY = 64 * 1024;

export async function POST(request: NextRequest) {
  try {
    const cfg = polarConfig();
    if (!cfg) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const raw = await request.text();
    if (raw.length > MAX_BODY) return NextResponse.json({ error: 'Too large' }, { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    }
    const hook = parsePolarWebhook(json);
    if (!hook) return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
    if (hook.event === 'PING') return NextResponse.json({ ok: true });

    if (!verifyPolarSignature(raw, request.headers.get('polar-webhook-signature'), cfg.webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
    }
    if (hook.event === 'OTHER') return NextResponse.json({ ok: true });

    const admin = getSupabaseAdmin();
    const conn = await findProviderConnection(admin, 'polar', hook.userId);
    if (!conn) return NextResponse.json({ ok: true });

    const result = await importPolarExercise(admin, cfg, conn, hook.exerciseId);
    if (result === 'unauthorized') await markRevoked(admin, conn.id);
    else if (result === 'failed') await recordDelivery(admin, conn.id, { ok: false, error: 'A workout from Polar could not be fetched. It is retried every day.' });
    else if (result !== 'refused') await recordDelivery(admin, conn.id, { ok: true });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    reportRouteError('[webhooks/polar] error:', error);
    // Still a 200: the daily run recovers the exercise; a 5xx only teaches
    // Polar to stop calling.
    return NextResponse.json({ ok: true });
  }
}
