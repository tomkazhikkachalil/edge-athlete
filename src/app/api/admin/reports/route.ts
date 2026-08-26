import { NextRequest, NextResponse } from 'next/server';
import { UUID_RE } from '@/lib/uuid';
import { getSupabaseAdmin, requireAdmin } from '@/lib/auth-server';
import { toProxyUrl } from '@/lib/media/proxy-url';

const VALID_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
// ── GET /api/admin/reports ────────────────────────────────────────────────────
// Message-report triage queue. The message_reports table has been written
// since migration 019 with NOTHING reading it — reports went into a black
// hole. Admin-only (ADMIN_EMAILS allowlist).
export async function GET(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();
    const { searchParams } = new URL(request.url);

    const status = searchParams.get('status') || 'open';
    if (!VALID_STATUSES.includes(status) && status !== 'all') {
      return NextResponse.json({ error: 'Invalid status filter' }, { status: 400 });
    }

    let query = supabase
      .from('message_reports')
      .select(`
        id, reason, details, status, created_at,
        message:message_id ( id, content, type, media_url, deleted_at ),
        reporter:reporter_id ( id, first_name, last_name, full_name, handle ),
        reported:reported_profile_id ( id, first_name, last_name, full_name, handle )
      `)
      .order('created_at', { ascending: false })
      .limit(100);

    if (status !== 'all') {
      query = query.eq('status', status);
    }

    const { data: reports, error } = await query;
    if (error) {
      console.error('GET /api/admin/reports error:', error);
      return NextResponse.json({ error: 'Failed to load reports' }, { status: 500 });
    }

    // Proxy reported message media (the moderator override in the proxy grants
    // admins access regardless of conversation membership).
    const proxiedReports = (reports || []).map((r) => {
      const report = r as unknown as { message?: { id: string; media_url: string | null } | Array<{ id: string; media_url: string | null }> | null };
      const message = Array.isArray(report.message) ? report.message[0] : report.message;
      return message?.media_url
        ? { ...report, message: { ...message, media_url: toProxyUrl(message.media_url, { type: 'message', id: message.id }) } }
        : report;
    });
    return NextResponse.json({ reports: proxiedReports });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('GET /api/admin/reports error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// ── PATCH /api/admin/reports ──────────────────────────────────────────────────
// Move a report through the triage workflow.
export async function PATCH(request: NextRequest) {
  try {
    await requireAdmin(request);
    const supabase = getSupabaseAdmin();
    const body = await request.json();
    const { reportId, status } = body;

    if (!reportId || !UUID_RE.test(reportId)) {
      return NextResponse.json({ error: 'Valid reportId is required' }, { status: 400 });
    }
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
    }

    const { error, count } = await supabase
      .from('message_reports')
      .update({ status }, { count: 'exact' })
      .eq('id', reportId);

    if (error) {
      console.error('PATCH /api/admin/reports error:', error);
      return NextResponse.json({ error: 'Failed to update report' }, { status: 500 });
    }
    if (!count) {
      return NextResponse.json({ error: 'Report not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('PATCH /api/admin/reports error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
