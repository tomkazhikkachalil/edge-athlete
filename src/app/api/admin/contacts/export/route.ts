import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { allContactsForExport } from '@/lib/contacts/admin-server';
import { contactsCsv, exportFileName, marketingList } from '@/lib/contacts/rules';
import { reportRouteError } from '@/lib/observability/report';

/**
 * GET /api/admin/contacts/export — the CSV (266). Owner-only. `?list=all`
 * (default: every submission, newest first) or `?list=marketing` (the
 * consented addresses, one row per email — the file for a mailing tool).
 * The cells are RFC 4180 and formula-safe (`contactsCsv`). Past the cap the
 * last line says the file is a floor.
 */
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const list = request.nextUrl.searchParams.get('list') === 'marketing' ? 'marketing' : 'all';
    const { rows, truncated } = await allContactsForExport(getSupabaseAdmin());
    const chosen = list === 'marketing' ? marketingList(rows) : rows;
    let csv = contactsCsv(chosen);
    if (truncated) csv += `# truncated: only the newest ${rows.length} submissions are included\r\n`;
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(list, new Date())}"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[GET /api/admin/contacts/export]', error);
    return NextResponse.json({ error: 'Could not build the export' }, { status: 500, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
