/**
 * User media presets (Phase 4, round E-W3): named editor "looks".
 *
 * Access model: RLS ON + REVOKE ALL on the table (migration 121) — all
 * access flows through here on the admin client with ownership enforced
 * in app code, the app-wide norm. Every stored look is zod-validated
 * (lookSchema) as untrusted input on write.
 *
 * Degrades gracefully before migration 121 runs: missing table → GET
 * returns [], writes return 503 with a clear message.
 */

import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/uuid';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { isNeutralLook, lookSchema } from '@/lib/media/look';

/** App-layer cap — presets are a shelf, not a library. */
const MAX_PRESETS_PER_USER = 24;

/** Postgres reports a missing relation as 42P01; PostgREST (which is what
 *  supabase-js actually talks to) reports a table absent from its schema
 *  cache as PGRST205. Both mean "migration 121 hasn't run here yet". */
function tableMissing(error: { code?: string } | null): boolean {
  return error?.code === '42P01' || error?.code === 'PGRST205';
}

export async function GET(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from('user_media_presets')
      .select('id, name, look')
      .eq('profile_id', user.id)
      .order('created_at', { ascending: false })
      .limit(MAX_PRESETS_PER_USER);
    if (error) {
      if (tableMissing(error)) return NextResponse.json({ presets: [] });
      throw error;
    }
    return NextResponse.json({ presets: data ?? [] });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      name?: unknown;
      look?: unknown;
    } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 40) {
      return NextResponse.json({ error: 'Preset name must be 1–40 characters' }, { status: 400 });
    }
    const parsed = lookSchema.safeParse(body?.look);
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid look' }, { status: 400 });
    }
    if (isNeutralLook(parsed.data)) {
      return NextResponse.json({ error: 'This look has no adjustments to save' }, { status: 400 });
    }

    const admin = getSupabaseAdmin();
    const { count, error: countError } = await admin
      .from('user_media_presets')
      .select('id', { count: 'exact', head: true })
      .eq('profile_id', user.id);
    if (countError) {
      if (tableMissing(countError)) {
        return NextResponse.json({ error: 'Presets are not available yet' }, { status: 503 });
      }
      throw countError;
    }
    if ((count ?? 0) >= MAX_PRESETS_PER_USER) {
      return NextResponse.json(
        { error: `Preset limit reached (${MAX_PRESETS_PER_USER}) — remove one first` },
        { status: 409 }
      );
    }

    const { data, error } = await admin
      .from('user_media_presets')
      .insert({ profile_id: user.id, name, look: parsed.data })
      .select('id, name, look')
      .single();
    if (error) throw error;
    return NextResponse.json({ preset: data }, { status: 201 });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    const id = request.nextUrl.searchParams.get('id');
    if (id && !isUuid(id)) {
      return NextResponse.json({ error: 'Invalid preset ID' }, { status: 400 });
    }
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
    const admin = getSupabaseAdmin();
    // Ownership enforced in the filter — admin bypasses RLS by design here.
    const { error } = await admin
      .from('user_media_presets')
      .delete()
      .eq('id', id)
      .eq('profile_id', user.id);
    if (error && !tableMissing(error)) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
