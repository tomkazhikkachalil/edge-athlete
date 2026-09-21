import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin, requireModerator } from '@/lib/auth-server';
import { parseBody, uuid } from '@/lib/validation';
import { PLATFORM_ROLES } from '@/lib/tickets/types';
import { reportRouteError } from '@/lib/observability/report';

/**
 * /api/admin/roles — the platform admin roles (Support & Reporting, Spec 1;
 * migration 222). OWNER-ONLY on every method (intent 'manage_roles' — the
 * doc's rule: a Moderator "cannot delete tickets or change roles", enforced
 * here, not only in the UI). The owner's own authority comes from the env
 * allowlist, so nothing here can lock the owner out.
 *
 *   GET            → { roles: [{ profile_id, role, granted_by, created_at, name, handle }] }
 *   POST { profile_id, role }  → upsert (a moderator may be promoted; an owner row is allowed but the allowlist is the real owner list)
 *   DELETE { profile_id }      → remove the row
 *
 * Pre-222 every method answers 503 "not available yet" (42P01) — refused by name.
 */

const NO_STORE = { 'Cache-Control': 'private, no-store' } as const;

const RoleBody = z.object({
  profile_id: uuid,
  role: z.enum(PLATFORM_ROLES),
});

const RemoveBody = z.object({ profile_id: uuid });

function notLive() {
  return NextResponse.json({ error: 'Support roles are not available yet.' }, { status: 503, headers: NO_STORE });
}

export async function GET(request: NextRequest) {
  try {
    await requireModerator(request, { intent: 'manage_roles' });
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('platform_admins')
      .select('profile_id, role, granted_by, created_at, profile:profiles!platform_admins_profile_id_fkey(first_name, last_name, handle)')
      .order('created_at', { ascending: true });
    if (error) {
      if (error.code === '42P01') return notLive();
      reportRouteError('[admin/roles GET]', error.message);
      return NextResponse.json({ error: 'Could not load roles' }, { status: 500, headers: NO_STORE });
    }
    const roles = (data ?? []).map(r => {
      const p = (Array.isArray(r.profile) ? r.profile[0] : r.profile) as { first_name?: string | null; last_name?: string | null; handle?: string | null } | null;
      return {
        profile_id: r.profile_id,
        role: r.role,
        granted_by: r.granted_by,
        created_at: r.created_at,
        name: [p?.first_name, p?.last_name].filter(Boolean).join(' ') || null,
        handle: p?.handle ?? null,
      };
    });
    return NextResponse.json({ roles }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[admin/roles GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await requireModerator(request, { intent: 'manage_roles' });
    const parsed = await parseBody(request, RoleBody);
    if (!parsed.success) return parsed.response;
    const { profile_id, role } = parsed.data;

    const admin = getSupabaseAdmin();
    const { data: profile } = await admin.from('profiles').select('id').eq('id', profile_id).maybeSingle();
    if (!profile) return NextResponse.json({ error: 'No such profile' }, { status: 404, headers: NO_STORE });

    const { error } = await admin
      .from('platform_admins')
      .upsert({ profile_id, role, granted_by: user.id }, { onConflict: 'profile_id' });
    if (error) {
      if (error.code === '42P01') return notLive();
      reportRouteError('[admin/roles POST]', error.message);
      return NextResponse.json({ error: 'Could not save the role' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true, profile_id, role }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[admin/roles POST]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    await requireModerator(request, { intent: 'manage_roles' });
    const parsed = await parseBody(request, RemoveBody);
    if (!parsed.success) return parsed.response;

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('platform_admins').delete().eq('profile_id', parsed.data.profile_id);
    if (error) {
      if (error.code === '42P01') return notLive();
      reportRouteError('[admin/roles DELETE]', error.message);
      return NextResponse.json({ error: 'Could not remove the role' }, { status: 500, headers: NO_STORE });
    }
    return NextResponse.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    reportRouteError('[admin/roles DELETE]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: NO_STORE });
  }
}
