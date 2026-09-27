// ── Team logo (teams & divisions program, PR 6; mig 242) ─────────────────────
// The org-site logo recipe (org-sites/logo-server.ts) for a TEAM: 10MB, the
// shared image allowlist (no SVG), the fixed `uploads` bucket, rollback on a
// failed row write, best-effort removal of the old file. teams.logo_path
// stores the BARE path `team-logos/{teamId}/{file}` (242's CHECK) — the
// storage sweep never deletes under that prefix (PROTECTED_PREFIXES, PR 0),
// and the tokenless streamer (/api/media/team-logo/[teamId]) serves only it.

import { NextResponse } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ORG_ID } from '@/lib/orgs/org-ref';
import { ALLOWED_IMAGE_MIME } from '@/lib/media/validation';
import { TEAM_LOGO_PREFIX, teamLogoUrl } from './logo-url';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- matches the authz.ts Admin alias; schema-agnostic helper
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[TEAM LOGO]';
const MAX_LOGO_BYTES = 10 * 1024 * 1024;
export { TEAM_LOGO_PREFIX, teamLogoUrl } from './logo-url';

async function readTeam(admin: Admin, orgId: string, teamId: string) {
  const { data } = await admin.from('teams').select('id, logo_path').eq('id', teamId).eq(ORG_ID, orgId).maybeSingle();
  return data as { id: string; logo_path: string | null } | null;
}

async function removeManagedFile(admin: Admin, path: string | null) {
  if (!path || !path.startsWith(TEAM_LOGO_PREFIX)) return;
  const { error } = await admin.storage.from('uploads').remove([path]);
  if (error) console.warn(`${TAG} previous logo cleanup failed:`, error);
}

export async function teamLogoPOST(admin: Admin, orgId: string, teamId: string, file: File): Promise<NextResponse> {
  const team = await readTeam(admin, orgId, teamId);
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: 'Logo must be less than 10MB' }, { status: 400 });
  if (!(ALLOWED_IMAGE_MIME as readonly string[]).includes(file.type)) {
    return NextResponse.json({ error: 'Please select a valid image file (JPG, PNG, GIF, or WebP)' }, { status: 400 });
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const filePath = `${TEAM_LOGO_PREFIX}${team.id}/${Date.now()}.${ext}`;

  const { error: uploadError } = await admin.storage.from('uploads').upload(filePath, file, { cacheControl: '3600', upsert: false });
  if (uploadError) {
    console.error(`${TAG} upload error:`, uploadError);
    return NextResponse.json({ error: 'Failed to upload the logo' }, { status: 500 });
  }
  const { error: updateError } = await admin.from('teams').update({ logo_path: filePath }).eq('id', team.id).eq(ORG_ID, orgId);
  if (updateError) {
    await admin.storage.from('uploads').remove([filePath]);
    console.error(`${TAG} db update error:`, updateError);
    return NextResponse.json({ error: 'Failed to save the logo' }, { status: 500 });
  }
  await removeManagedFile(admin, team.logo_path);
  return NextResponse.json({ success: true, logoPath: filePath, logoUrl: teamLogoUrl(team.id, filePath) });
}

export async function teamLogoDELETE(admin: Admin, orgId: string, teamId: string): Promise<NextResponse> {
  const team = await readTeam(admin, orgId, teamId);
  if (!team) return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  const { error } = await admin.from('teams').update({ logo_path: null }).eq('id', team.id).eq(ORG_ID, orgId);
  if (error) {
    console.error(`${TAG} clear error:`, error);
    return NextResponse.json({ error: 'Failed to remove the logo' }, { status: 500 });
  }
  await removeManagedFile(admin, team.logo_path);
  return NextResponse.json({ success: true });
}
