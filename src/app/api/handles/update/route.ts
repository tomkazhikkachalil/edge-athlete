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

    // Supervised minors: the same PII guard that vets the handle at creation
    // applies to renames — without this, a child could rename themselves to
    // exactly the full-name/birth-year handle the console refused.
    const { data: renamer } = await supabaseAdmin
      .from('profiles')
      .select('supervision_state, first_name, last_name, dob')
      .eq('id', user.id)
      .maybeSingle();
    if (renamer?.supervision_state === 'supervised') {
      const { validateSupervisedHandle } = await import('@/lib/supervised-credentials');
      const dobYear = renamer.dob ? new Date(renamer.dob).getFullYear() : null;
      const guard = validateSupervisedHandle(
        handle,
        renamer.first_name || '',
        renamer.last_name || '',
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
        p_profile_id: user.id,
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

    return NextResponse.json({
      success: true,
      message: result.message,
      handle: result.new_handle
    });
  } catch (error) {
    console.error('Error in POST /api/handles/update:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
