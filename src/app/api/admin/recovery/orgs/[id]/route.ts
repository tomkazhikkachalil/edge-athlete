import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RECOVERY_NOTE_MAX } from '@/lib/authority/recovery';
import { addOwner, mintRecoveryLink, openRecovery, readOrgPanel, removeOwner, revokeStaff, setRole, siteAction, type Result } from '@/lib/authority/recovery-server';
import { reportRouteError } from '@/lib/observability/report';

/**
 * The org recovery panel (Authority PR 4). GET reads everything the team
 * needs to decide; POST {action, ticket, note, …} is one act. Every act names
 * an open ticket, is written to the authority log as Edge Athlete support,
 * lands in the ticket's history and bells the org's owners and managers.
 * Owner-only today (intent 'recover_authority'); the `authority-admin` bucket.
 */
const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;
const common = { ticket: z.string().trim().min(1).max(64), note: z.string().max(RECOVERY_NOTE_MAX).optional().nullable() };
const Person = z.string().trim().min(1).max(320);
const Id = z.string().regex(UUID_RE);
const Body = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add_owner'), person: Person, ...common }),
  z.object({ action: z.literal('remove_owner'), profile: Id, replacement: Person.optional().nullable(), ...common }),
  z.object({ action: z.literal('set_role'), profile: Id, role: z.enum(['manager', 'member']), ...common }),
  z.object({ action: z.literal('revoke_staff'), row: Id, ...common }),
  z.object({ action: z.literal('recovery_link'), email: z.string().trim().min(3).max(320), ...common }),
  z.object({ action: z.literal('hold'), ...common }),
  z.object({ action: z.literal('release'), ...common }),
  z.object({ action: z.literal('delist'), ...common }),
  z.object({ action: z.literal('restore_revision'), revision: Id, ...common }),
  z.object({ action: z.literal('restore_identity'), audit: Id, ...common }),
]);

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await requireModerator(request, { intent: 'recover_authority' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const panel = await readOrgPanel(getSupabaseAdmin(), id);
    if (!panel) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    return NextResponse.json(panel, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/recovery/orgs/[id]]', error);
    return NextResponse.json({ error: 'Could not load the organization' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { user } = await requireModerator(request, { intent: 'recover_authority' });
    if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: NO_STORE });
    const limited = await enforceRateLimit(request, 'authority-admin', { userId: user.id });
    if (limited) return limited;
    const parsed = await parseBody(request, Body);
    if (!parsed.success) return parsed.response;
    const body = parsed.data;
    const admin = getSupabaseAdmin();
    const opened = await openRecovery(admin, user.id, body.ticket, body.note);
    if (!opened.ok) return NextResponse.json({ error: opened.error }, { status: opened.status, headers: NO_STORE });
    const ctx = opened.ctx;

    let result: Result<object>;
    switch (body.action) {
      case 'add_owner': result = await addOwner(admin, ctx, id, body.person); break;
      case 'remove_owner': result = await removeOwner(admin, ctx, id, body.profile, body.replacement ?? null); break;
      case 'set_role': result = await setRole(admin, ctx, id, body.profile, body.role); break;
      case 'revoke_staff': result = await revokeStaff(admin, ctx, id, body.row); break;
      case 'recovery_link': result = await mintRecoveryLink(admin, ctx, id, body.email, request.nextUrl.origin); break;
      case 'restore_revision': result = await siteAction(admin, ctx, id, { action: 'restore_revision', revisionId: body.revision }); break;
      case 'restore_identity': result = await siteAction(admin, ctx, id, { action: 'restore_identity', auditId: body.audit }); break;
      default: result = await siteAction(admin, ctx, id, { action: body.action }); break;
    }
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status, headers: NO_STORE });
    return NextResponse.json(result, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[POST /api/admin/recovery/orgs/[id]]', error);
    return NextResponse.json({ error: 'Could not apply the change' }, { status: 500, headers: NO_STORE });
  }
}
