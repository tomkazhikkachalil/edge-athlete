import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireAuth } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { writeUnitSystem } from '@/lib/activities/unit-prefs-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * PATCH /api/settings/units — save the caller's OWN unit system
 * (profiles.unit_system, 293): metric (°C, km, kg) or imperial (°F, mi, lb)
 * for everything measured, so the choice follows the person across devices.
 *   { system: 'metric' | 'imperial' } → { system }
 *
 * Always `.eq('id', user.id)` — the choice belongs to the ACCOUNT, never to a
 * guardian-managed activeProfile, so no targetProfileId is accepted. The
 * client reads it back off useAuth().profile and mirrors it into the device
 * cache (useUnitSystem); no GET here.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const Body = z.object({ system: z.enum(['metric', 'imperial']) });

export async function PATCH(request: NextRequest) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'units', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const out = await writeUnitSystem(getSupabaseAdmin(), user.id, parsed.data.system);
    if (!out.ok) return NextResponse.json({ error: 'Could not save your units' }, { status: 500, headers: NO_STORE });
    return NextResponse.json({ system: parsed.data.system }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[PATCH /api/settings/units]', error);
    return NextResponse.json({ error: 'Could not save your units' }, { status: 500, headers: NO_STORE });
  }
}
