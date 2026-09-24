// ── One handler for both kinds (Round 5 E-2): the body of /api/{leagues,clubs}/[id]/roster-import ──
// The two route files are shims that pass their kind; the gates live HERE.
// Lifted from the league file — the club twin differed from it by the word only.

import { NextRequest, NextResponse } from 'next/server';
import { type OrgKind, ORG_LABEL } from '@/lib/orgs/org-ref';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { enforceRateLimit } from '@/lib/rate-limit';
import { parseBody } from '@/lib/validation';
import { RosterImportSchema } from '@/lib/orgs/validate';
import { requireOrgManager } from '@/lib/orgs/structure-server';
import { importRoster, parseRosterImport, remintAthleteClaim } from '@/lib/orgs/roster-import';
import { UUID_RE } from '@/lib/golf/course-catalog';
import { reportRouteError } from '@/lib/observability/report';

// ── /api/{leagues,clubs}/[id]/roster-import — paste-import stubs / re-mint (R3) ────
// Thin twin; the mint orchestration + sub-org membership writers live in
// orgs/roster-import.ts. Manager-gated; 50 rows per request.

export async function rosterImportRoutePOST(request: NextRequest, kind: OrgKind, params: { id: string }) {
  try {
    const user = await requireAuth(request);
    const limited = await enforceRateLimit(request, 'roster-import', { userId: user.id });
    if (limited) return limited;
    const { id } = params;
    if (!UUID_RE.test(id)) {
      return NextResponse.json({ error: `${ORG_LABEL[kind]} not found` }, { status: 404 });
    }
    const admin = getSupabaseAdmin();
    const gate = await requireOrgManager(admin, user, kind, id, { intent: 'manage_members' });
    if (!gate.ok) return gate.response;

    const parsed = await parseBody(request, RosterImportSchema);
    if (!parsed.success) return parsed.response;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';

    if ('remintProfileId' in parsed.data) {
      const minted = await remintAthleteClaim(admin, {
        side: kind,
        orgId: id,
        orgName: gate.org.name,
        profileId: parsed.data.remintProfileId,
        createdBy: user.id,
        appUrl,
      });
      if (!minted) {
        return NextResponse.json(
          { error: `No unclaimed roster athlete with that id in this ${kind}` },
          { status: 404 }
        );
      }
      return NextResponse.json({ ok: true, ...minted });
    }

    const { rows, errors } = parseRosterImport(parsed.data.text);
    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'No importable lines', lineErrors: errors },
        { status: 400 }
      );
    }
    if (rows.length > 50) {
      return NextResponse.json(
        { error: 'Up to 50 athletes per import — split the list' },
        { status: 400 }
      );
    }
    const result = await importRoster(admin, {
      side: kind,
      orgId: id,
      orgName: gate.org.name,
      teamId: parsed.data.teamId,
      rows,
      createdBy: user.id,
      appUrl,
    });
    if (!result.ok) {
      return NextResponse.json({ error: 'Team not found' }, { status: 404 });
    }
    return NextResponse.json({ ok: true, report: result.report, lineErrors: errors });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[ROSTER IMPORT] POST error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
