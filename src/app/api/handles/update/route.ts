import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, getServerAuth } from '@/lib/auth-server';

export async function POST(request: NextRequest) {
  try {
    const supabaseAdmin = getSupabaseAdmin();
    const body = await request.json();
    const { handle } = body;

    if (!handle) {
      return NextResponse.json(
        { error: 'Handle is required' },
        { status: 400 }
      );
    }

    // Get authenticated user
    const { user, error: userError } = await getServerAuth(request);

    if (userError || !user) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    // Round H: a guardian may rename their managed athlete via
    // targetProfileId (manage_settings). Everyone else renames themselves.
    let profileId = user.id;
    if (
      typeof body.targetProfileId === 'string' &&
      body.targetProfileId &&
      body.targetProfileId !== user.id
    ) {
      const { requireProfileRole } = await import('@/lib/auth-server');
      await requireProfileRole(request, body.targetProfileId, 'manage_settings');
      profileId = body.targetProfileId;
    }

    // Supervised minors: the same PII guard that vets the handle at creation
    // applies to renames — without this, a child could rename themselves to
    // exactly the full-name/birth-year handle the console refused. Anchored
    // to the TARGET profile, so it binds guardians too (consistency with
    // creation).
    const { data: target } = await supabaseAdmin
      .from('profiles')
      .select('supervision_state, first_name, last_name, dob')
      .eq('id', profileId)
      .maybeSingle();
    const targetSupervised = target?.supervision_state === 'supervised';
    if (targetSupervised) {
      const { validateSupervisedHandle } = await import('@/lib/supervised-credentials');
      // getUTCFullYear, matching the sibling guardian routes: dob is a DATE
      // column, so new Date() lands on UTC midnight and a LOCAL getter would
      // report the previous year for a Jan 1 dob whenever the runtime is not
      // UTC. This feeds the handle spoofing guard — it must not depend on
      // where the process happens to run.
      const dobYear = target?.dob ? new Date(target.dob).getUTCFullYear() : null;
      const guard = validateSupervisedHandle(
        handle,
        target?.first_name || '',
        target?.last_name || '',
        Number.isFinite(dobYear) ? dobYear : null
      );
      if (!guard.ok) {
        return NextResponse.json(
          { success: false, message: guard.reason },
          { status: 400 }
        );
      }
    }

    // Call the database function to update handle
    const { data, error } = await supabaseAdmin
      .rpc('update_user_handle', {
        p_profile_id: profileId,
        p_new_handle: handle
      });

    if (error) {
      console.error('Error updating handle:', error);
      return NextResponse.json(
        { error: 'Failed to update handle' },
        { status: 500 }
      );
    }

    // Return the first row (function returns a table)
    const result = data && data.length > 0 ? data[0] : null;

    if (!result) {
      return NextResponse.json(
        {
          success: false,
          message: 'Unable to update handle'
        },
        { status: 500 }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          message: result.message
        },
        { status: 400 }
      );
    }

    // Round H: a supervised athlete's handle is identity — bell the
    // guardians (actor excluded, so a guardian's own rename reaches only
    // co-guardians). Best-effort.
    if (targetSupervised) {
      const { notifyGuardians } = await import('@/lib/guardian-notify');
      await notifyGuardians(supabaseAdmin, profileId, {
        type: 'profile_change',
        title: `${target?.first_name || 'Your athlete'}'s username changed`,
        message: `New username: @${result.new_handle}`,
        actionUrl: `/athlete/${profileId}`,
        actorId: user.id,
        metadata: { fields: ['handle'] },
      }, user.id);
    }

    return NextResponse.json({
      success: true,
      message: result.message,
      handle: result.new_handle
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error('Error in POST /api/handles/update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
