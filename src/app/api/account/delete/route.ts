import { NextRequest, NextResponse } from 'next/server';
import { getServerClient } from '@/lib/auth-server';
import { supabaseAdmin } from '@/lib/supabase';
import { FEATURE_FLAGS } from '@/lib/features';
import { hardDeleteAccount } from '@/lib/account-deletion';
import { formatDisplayName } from '@/lib/formatters';

export async function DELETE(request: NextRequest) {
  try {
    const supabase = getServerClient(request);

    // 1. Verify user is authenticated
    const { data: { user }, error: userError } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // 2. Get and validate request body
    const body = await request.json();
    const { confirmText, password } = body;

    if (!confirmText || !password) {
      return NextResponse.json({
        error: 'Confirmation text and password are required'
      }, { status: 400 });
    }

    // 3. Verify password by re-authenticating
    if (!user.email) {
      return NextResponse.json({ error: 'User email not found' }, { status: 400 });
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: user.email,
      password,
    });

    if (signInError) {
      console.error('Password verification failed:', signInError);
      return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
    }

    // 4. Verify admin client is available
    if (!supabaseAdmin) {
      console.error('Supabase admin client not available');
      return NextResponse.json({
        error: 'Server configuration error'
      }, { status: 500 });
    }

    // 5. Guardian preflight (guardian-profiles). Two failure modes without
    // this: deleting a guardian whose child has no credentials yet trips
    // the zero-access constraint MID-deletion (500 with the guardian's
    // data half gone), and a child WITH credentials would be silently
    // orphaned. Both are refused up front, before anything is deleted.
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES) {
      // Supervised minors never self-delete — deletion is the guardian's
      // consent-withdrawal decision.
      const { data: ownProfile } = await supabaseAdmin
        .from('profiles')
        .select('supervision_state')
        .eq('id', userId)
        .maybeSingle();
      if (ownProfile?.supervision_state === 'supervised') {
        return NextResponse.json({
          error: 'Your account is managed by your guardian. Ask them to make changes.'
        }, { status: 403 });
      }

      const { data: guardianRows } = await supabaseAdmin
        .from('profile_access')
        .select('profile_id')
        .eq('user_id', userId)
        .eq('role', 'guardian');
      const childIds = (guardianRows ?? []).map(r => r.profile_id);

      if (childIds.length > 0) {
        const [{ data: children }, { data: allGuardianRows }] = await Promise.all([
          supabaseAdmin
            .from('profiles')
            .select('id, first_name, last_name, full_name, supervision_state')
            .in('id', childIds),
          supabaseAdmin
            .from('profile_access')
            .select('profile_id, user_id')
            .in('profile_id', childIds)
            .eq('role', 'guardian'),
        ]);

        const guardianCount = new Map<string, number>();
        for (const row of allGuardianRows ?? []) {
          guardianCount.set(row.profile_id, (guardianCount.get(row.profile_id) ?? 0) + 1);
        }
        const blockers = (children ?? []).filter(
          c => c.supervision_state === 'supervised' && (guardianCount.get(c.id) ?? 0) <= 1
        );
        if (blockers.length > 0) {
          const names = blockers
            .map(c => formatDisplayName(c.first_name, null, c.last_name, c.full_name))
            .join(' and ');
          return NextResponse.json({
            error: `You manage the athlete profile${blockers.length > 1 ? 's' : ''} for ${names}. Delete each athlete's profile or complete their account transfers first.`,
            children: blockers.map(c => ({
              id: c.id,
              name: formatDisplayName(c.first_name, null, c.last_name, c.full_name),
            })),
          }, { status: 409 });
        }

        // Co-guardian children keep their other guardian; record that this
        // guardian's access ended. Best-effort — the access rows themselves
        // cascade with the profile either way.
        const audit = childIds.map(childId => ({
          profile_id: childId,
          user_id: userId,
          action: 'revoked',
          old_role: 'guardian',
          actor_id: userId,
        }));
        const { error: auditError } = await supabaseAdmin
          .from('profile_access_audit')
          .insert(audit);
        if (auditError) {
          console.error('[Account Deletion] guardian audit insert failed:', auditError);
        }
      }
    }

    // 6-8. Delete everything (shared engine: DB rows in order, storage
    // best-effort, then the auth user).
    let warnings: string[] = [];
    try {
      ({ warnings } = await hardDeleteAccount(supabaseAdmin, userId));
    } catch (dbError) {
      console.error('[Account Deletion] deletion error:', dbError);
      const message = dbError instanceof Error ? dbError.message : 'Unknown error';
      if (message.startsWith('Failed to delete authentication user')) {
        // CRITICAL - if auth deletion fails, the email remains registered
        return NextResponse.json({
          error: 'Failed to delete authentication user',
          details: message,
          hint: 'Account data deleted but email may still be reserved. Contact support.'
        }, { status: 500 });
      }
      return NextResponse.json({
        error: 'Failed to delete account data',
        details: message
      }, { status: 500 });
    }

    // 9. Sign out the user
    await supabase.auth.signOut();

    if (warnings.length > 0) {
      console.warn('[Account Deletion] Storage cleanup warnings:', warnings);
    }

    return NextResponse.json({
      success: true,
      message: 'Account deleted successfully',
      warnings: warnings.length > 0 ? warnings : undefined
    });

  } catch (error) {
    console.error('[Account Deletion] Unexpected error:', error);
    return NextResponse.json({
      error: 'Internal server error during account deletion',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
