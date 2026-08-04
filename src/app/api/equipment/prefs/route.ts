import { NextRequest, NextResponse } from 'next/server';
import { getServerAuth, getSupabaseAdmin } from '@/lib/auth-server';
import { sanitizeEquipmentPrefs } from '@/lib/equipment-prefs';

/**
 * PATCH /api/equipment/prefs — save the caller's OWN equipment display
 * settings (profiles.equipment_prefs, migration 065). The whole body is
 * passed through sanitizeEquipmentPrefs: unknown keys and invalid values
 * are silently dropped, so the stored JSON is always in-contract.
 */
export async function PATCH(request: NextRequest) {
  try {
    const { user, error: authError } = await getServerAuth(request);
    if (authError || !user) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    if (body === null || typeof body !== 'object') {
      return NextResponse.json({ error: 'Invalid preferences body' }, { status: 400 });
    }

    const prefs = sanitizeEquipmentPrefs(body);
    const admin = getSupabaseAdmin();
    const { error } = await admin
      .from('profiles')
      .update({ equipment_prefs: prefs })
      .eq('id', user.id);

    if (error) {
      console.error('Equipment prefs update error:', error);
      return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
    }

    return NextResponse.json({ prefs });
  } catch (error) {
    console.error('Equipment prefs PATCH error:', error);
    return NextResponse.json({ error: 'Failed to save settings' }, { status: 500 });
  }
}
