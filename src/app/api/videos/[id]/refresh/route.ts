import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { reportRouteError } from '@/lib/observability/report';
import { isOrgKind } from '@/lib/orgs/org-ref';
import { readVideoForViewer, recordVideoDetails } from '@/lib/videos/videos-server';
import { CALL_REFUSALS, type ConnectionOwner } from '@/lib/videos/youtube-connection';
import { callWithToken } from '@/lib/videos/youtube-connections-server';
import { youtubeConfig, youtubeVideoLookup } from '@/lib/videos/google-youtube-server';
import { parseChapters } from '@/lib/videos/youtube-connection';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PRIVATE = { 'Cache-Control': 'private, no-store' } as const;

/**
 * POST /api/videos/[id]/refresh — read the video's details from YouTube
 * through the OWNER's connection (Videos program Phase 3): the duration
 * Phase 1 left null (the cards' badge), nothing else changes. A manager's
 * door; without a connection the answer says so (404) and the page keeps
 * what it has.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_RE.test(id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const { user, error: authError, limited } = await getServerAuth(request, { limit: 'video-write' });
    if (authError || !user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    if (limited) return limited;
    const cfg = youtubeConfig();
    if (!cfg) return NextResponse.json({ error: 'YouTube connections are not available here' }, { status: 404 });
    const admin = getSupabaseAdmin();
    const read = await readVideoForViewer(admin, id, user);
    if (!read) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    if (!read.canManage) return NextResponse.json({ error: 'Only a manager can refresh this video.' }, { status: 403 });

    let owner: ConnectionOwner;
    if (read.row.org_id) {
      const { data: org } = await admin.from('organizations').select('kind').eq('id', read.row.org_id).maybeSingle();
      owner = { kind: 'org', side: isOrgKind(org?.kind) ? org.kind : 'club', orgId: read.row.org_id };
    } else {
      owner = { kind: 'profile', profileId: read.row.profile_id ?? '' };
    }
    const called = await callWithToken(admin, cfg, owner, token => youtubeVideoLookup({ apiBase: cfg.apiBase, accessToken: token }, read.row.provider_video_id));
    if (!called.ok) return NextResponse.json({ error: called.error, reconnect: called.reconnect }, { status: called.status });
    const details = called.value;
    if (!details.ok) {
      const refused = CALL_REFUSALS[details.quota ? 'quota' : 'busy'];
      return NextResponse.json({ error: refused.error }, { status: refused.status });
    }
    if (!details.value) return NextResponse.json({ error: 'YouTube has no video with this id' }, { status: 404 });
    const saved = await recordVideoDetails(admin, id, { durationMs: details.value.durationMs });
    if (!saved.ok) return NextResponse.json({ error: saved.error }, { status: saved.status });
    const after = await readVideoForViewer(admin, id, user);
    // Paste and go (Nov 6): the chapters in the description (for "Add N chapters as highlights") and whether it embeds.
    return NextResponse.json({ video: after?.view ?? null, duration_ms: saved.value.duration_ms, privacy: details.value.privacy, embeddable: details.value.embeddable, chapters: parseChapters(details.value.description) }, { headers: PRIVATE });
  } catch (error) {
    reportRouteError('[api/videos/id/refresh] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
