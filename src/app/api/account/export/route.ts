import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { EXPORT_ROW_CAP, EXPORT_SECTIONS, buildExportBundle, exportFilename, type ExportRow } from '@/lib/account-export';
import { isMissingTableError } from '@/lib/orgs/validate';
import { reportRouteError } from '@/lib/observability/report';

/**
 * POST /api/account/export — the account's own data as one JSON file
 * (Nov 2 2026; the rule is src/lib/account-export.ts). A POST, not a GET:
 * it is an action behind the per-account `account-export` bucket (3 a day),
 * and the general write limit rides the same call. The admin client is
 * used because the person's rows span tables RLS scopes differently
 * (messages, memberships, entries); every read is `eq(<the account
 * column>, user.id)` and nothing else — the test pins the shape.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAuth(request, { limit: 'account-export' });
    const admin = getSupabaseAdmin();

    const { data: profile, error: profileError } = await admin.from('profiles').select('*').eq('id', user.id).maybeSingle();
    if (profileError) throw new Error(`profile read failed: ${profileError.message}`);

    const sections: Record<string, ExportRow[] | null> = {};
    for (const section of EXPORT_SECTIONS) {
      const { data, error } = await admin
        .from(section.table)
        .select('*')
        .eq(section.column, user.id)
        .limit(EXPORT_ROW_CAP + 1);
      if (error) {
        if (isMissingTableError(error.code)) { sections[section.key] = null; continue; }
        throw new Error(`${section.table} read failed: ${error.message}`);
      }
      sections[section.key] = (data ?? []) as ExportRow[];
    }

    const now = new Date();
    const bundle = buildExportBundle({ userId: user.id, email: user.email ?? null, profile: (profile as ExportRow | null) ?? null, now }, sections);
    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFilename(now)}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (err) {
    if (err instanceof Response) return err;
    reportRouteError('account export error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
