import { NextRequest, NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { supabase, supabaseAdmin } from '@/lib/supabase';
import { mapProfileUpsertError, isObfuscatedDuplicateSignUp } from '@/lib/signup-errors';
import { FEATURE_FLAGS } from '@/lib/features';
import { isValidDateString, isNotFutureDate } from '@/lib/date-validation';
import {
  isUnderThreshold,
  jurisdictionFromHeaders,
  getMinorThreshold,
} from '@/lib/config/minors-config';
import { createGuardianInvite } from '@/lib/guardian-invites';
import { emailService } from '@/lib/email-service';
import { enforceRateLimit } from '@/lib/rate-limit';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password, profileData } = body;


    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    // Before any DB/auth/SMTP work — the most expensive unauthenticated route.
    const limited = await enforceRateLimit(request, 'signup');
    if (limited) return limited;

    // ── DOB gate (guardian-profiles) ────────────────────────────────────────
    // ROUTING TABLE (the actor guard is load-bearing — pending_guardian must
    // be unreachable when a guardian is at the keyboard):
    //   actor == 'guardian'                    → guardian_signup (Step A;
    //                                            any DOB in the flow is the
    //                                            ATHLETE's, never gates this)
    //   actor == 'athlete' && age >= threshold → athlete_self_signup
    //   actor == 'athlete' && age <  threshold → pending_guardian (park +
    //                                            invite; NO auth user —
    //                                            COPPA data minimization)
    const actorRole = body.actorRole === 'guardian' ? 'guardian' : 'athlete';
    if (FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES && actorRole === 'athlete') {
      const dob: string | undefined = profileData?.birthday;
      if (!dob || !isValidDateString(dob) || !isNotFutureDate(dob)) {
        return NextResponse.json(
          { error: 'Please enter a valid date of birth.' },
          { status: 400 }
        );
      }
      const jurisdiction = jurisdictionFromHeaders(
        request.headers.get('x-vercel-ip-country'),
        request.headers.get('x-vercel-ip-country-region')
      );
      const today = new Date().toISOString().slice(0, 10);
      if (isUnderThreshold(dob, jurisdiction, today)) {
        const guardianEmail: string | undefined = body.guardianEmail;
        if (!guardianEmail || typeof guardianEmail !== 'string' || !guardianEmail.includes('@')) {
          // 422 tells the client to collect a guardian email — not a dead end.
          return NextResponse.json(
            { needsGuardian: true, error: 'A parent or guardian needs to set up this account. Please provide their email address.' },
            { status: 422 }
          );
        }
        if (guardianEmail.trim().toLowerCase() === email.toLowerCase()) {
          return NextResponse.json(
            { needsGuardian: true, error: "The guardian's email must be different from the athlete's email." },
            { status: 422 }
          );
        }
        if (!supabaseAdmin) {
          return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
        }
        // Re-submitting for the same child IS the resend/typo-correction
        // mechanism (no auth exists to manage a parked request): expire any
        // prior awaiting rows + their unconsumed invites so exactly one
        // invite is live per child email.
        const { data: priorRows } = await supabaseAdmin
          .from('pending_profiles')
          .select('id')
          .eq('child_email', email.toLowerCase())
          .eq('state', 'awaiting_guardian');
        if (priorRows && priorRows.length > 0) {
          const priorIds = priorRows.map(r => r.id);
          await supabaseAdmin.from('pending_profiles')
            .update({ state: 'expired' }).in('id', priorIds);
          await supabaseAdmin.from('guardian_invites')
            .update({ expires_at: new Date().toISOString() })
            .in('pending_profile_id', priorIds).is('consumed_at', null);
        }

        // profileData carries no credentials (password is a separate body
        // field, deliberately not parked — the athlete gets a supervised
        // login later via activation, never this password).
        const { data: pending, error: pendingError } = await supabaseAdmin
          .from('pending_profiles')
          .insert({
            payload: profileData ?? {},
            child_email: email.toLowerCase(),
            dob,
            jurisdiction,
            threshold_age: getMinorThreshold(jurisdiction),
          })
          .select('id')
          .single();
        if (pendingError || !pending) {
          Sentry.captureException(new Error(`signup: pending_profiles insert failed: ${pendingError?.message}`));
          return NextResponse.json({ error: 'Could not save the request. Please try again.' }, { status: 500 });
        }
        // A guardian who already has an account is a MATCH, not a collision:
        // the invite resolves to them; only the email copy/CTA differ.
        const { data: existingGuardian } = await supabaseAdmin
          .from('profiles')
          .select('id')
          .eq('email', guardianEmail.trim().toLowerCase())
          .maybeSingle();
        const guardianHasAccount = !!existingGuardian;

        const invite = await createGuardianInvite({
          admin: supabaseAdmin,
          inviteType: 'guardian_for_pending',
          invitedEmail: guardianEmail,
          pendingProfileId: pending.id,
        });
        // deliver() returns an honest boolean (and Sentry-tags failures) —
        // parked either way; a failed send is rescued via the admin
        // parked-profiles re-mint (dashboard/guardians).
        let guardianEmailSent = false;
        if (invite && process.env.SMTP_USER && process.env.SMTP_PASS) {
          const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://edge-athlete.vercel.app';
          guardianEmailSent = await emailService.sendGuardianInvite(
            guardianEmail,
            profileData?.first_name || '',
            `${appUrl}/invite/${invite.rawToken}`,
            appUrl,
            guardianHasAccount
          );
        }
        return NextResponse.json({
          parked: true,
          guardianEmailSent,
          message: guardianEmailSent
            ? "Almost there! We've emailed your parent or guardian a link to finish setting up your profile."
            : "Almost there! We couldn't send the email to your parent or guardian just now — ask them to contact support, or try signing up again later.",
        });
      }
    }

    
    // Check for existing emails if admin client is available
    if (supabaseAdmin) {
      // Check profiles table for existing emails (using admin client to bypass RLS)
      const { data: existingProfiles, error: checkError } = await supabaseAdmin
        .from('profiles')
        .select('email')
        .eq('email', email.toLowerCase());


      if (checkError && checkError.code !== 'PGRST116') {
        console.error('Database check error:', checkError);
        return NextResponse.json(
          { error: 'Database error occurred' },
          { status: 500 }
        );
      }

      // If we found any profiles with this email, it's already taken
      if (existingProfiles && existingProfiles.length > 0) {
        // Email already exists in profiles table
        return NextResponse.json(
          { 
            error: 'This email is already registered. Please log in instead.' 
          },
          { status: 409 }
        );
      }

      // NOTE: a listUsers() scan used to sit here as a second duplicate check,
      // but listUsers() only returns the first page (50 users), so it silently
      // stopped catching anything at scale. Auth-side duplicates are caught
      // deterministically below instead: signUp returns an explicit error when
      // confirmations are off, and a sanitized user with empty identities when
      // confirmations are on (isObfuscatedDuplicateSignUp).
    } else {
      console.warn('Admin client not available - skipping duplicate email check. Relying on Supabase Auth validation.');
    }


    // Proceed with Supabase Auth signup
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
    });

    

    if (error) {
      console.error('[SIGNUP] Supabase auth signup error:', error);
      
      // Handle various Supabase duplicate email errors
      if (error.message.includes('already registered') || 
          error.message.includes('already exists') ||
          error.message.includes('User already registered') ||
          error.message.includes('already been registered') ||
          error.message.includes('Email already') ||
          error.message.includes('duplicate')) {
        return NextResponse.json(
          { 
            error: 'There is already an account registered under this email address. Please use a different email or try logging in.' 
          },
          { status: 409 }
        );
      }

      Sentry.captureMessage('signup: auth signUp failed', {
        level: 'warning',
        extra: { code: error.code, status: error.status, message: error.message },
      });
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    // With email confirmations enabled, Supabase answers a signUp for an
    // already-registered email with a sanitized fake user (empty identities)
    // instead of an error. Detect it so the user isn't shown false success.
    if (isObfuscatedDuplicateSignUp(data.user)) {
      return NextResponse.json(
        {
          error:
            'This email is already registered. Please log in — or use "Resend confirmation" if you never confirmed your email.',
        },
        { status: 409 }
      );
    }

    // If no user was created, it might be a duplicate
    if (!data.user) {
      return NextResponse.json(
        {
          error: 'There is already an account registered under this email address. Please use a different email or try logging in.'
        },
        { status: 409 }
      );
    }

    // Create/update the profile with additional data (using admin client to bypass RLS if available)
    if (data.user) {
      const client = supabaseAdmin || supabase;

      if (!client) {
        console.error('[SIGNUP] No Supabase client available!');
        return NextResponse.json(
          { error: 'Server configuration error: Database client not initialized' },
          { status: 500 }
        );
      }

      // Create a full name from first and last name
      const fullName = [profileData.first_name, profileData.last_name]
        .filter(Boolean)
        .join(' ') || undefined;

      // Prepare complete profile data for INSERT
      const profileData_toInsert = {
        id: data.user.id,
        email: email.toLowerCase(),
        first_name: profileData.first_name,
        last_name: profileData.last_name,
        nickname: profileData.nickname || null,
        phone: profileData.phone || null,
        birthday: profileData.birthday || null,
        dob: profileData.birthday || null,
        gender: profileData.gender || null,
        location: profileData.location || null,
        postal_code: profileData.postal_code || null,
        // Guardian-branch signups ARE parents (097): server-authoritative,
        // never the client's value — routing sends 'parent' accounts to the
        // family console instead of the athlete onboarding wizard.
        user_type: actorRole === 'guardian' ? 'parent' : (profileData.user_type || 'athlete'),
        full_name: fullName || null,
        handle: profileData.handle ? profileData.handle.toLowerCase().trim() : null,
        display_name: profileData.nickname || fullName || profileData.handle || 'Athlete',
      };


      // Directly INSERT the profile (don't wait for trigger)
      // Use upsert to handle race conditions with trigger
      const { error: profileError } = await client
        .from('profiles')
        .upsert(profileData_toInsert, {
          onConflict: 'id',
          ignoreDuplicates: false
        });

      if (profileError) {
        console.error('[SIGNUP] Error updating profile:', profileError);
        console.error('[SIGNUP] Profile error details:', {
          message: profileError.message,
          code: profileError.code,
          details: profileError.details,
          hint: profileError.hint
        });
        Sentry.captureException(
          new Error(`signup: profile upsert failed: ${profileError.message}`),
          {
            extra: {
              code: profileError.code,
              details: profileError.details,
              hint: profileError.hint,
              userId: data.user.id,
            },
          }
        );

        // Roll back the just-created auth user — otherwise the email is
        // permanently blocked: retries hit "already registered" while login
        // force-signs-out on the missing profile row.
        if (supabaseAdmin) {
          const { error: rollbackError } = await supabaseAdmin.auth.admin.deleteUser(data.user.id);
          if (rollbackError) {
            console.error('[SIGNUP] rollback failed — orphaned auth user', data.user.id, rollbackError);
            Sentry.captureException(
              new Error(`signup: auth-user rollback failed: ${rollbackError.message}`),
              { extra: { userId: data.user.id } }
            );
          }
        } else {
          Sentry.captureMessage('signup: cannot roll back auth user (no admin client)', {
            level: 'warning',
          });
        }

        const mapped = mapProfileUpsertError(profileError);
        return NextResponse.json({ error: mapped.error }, { status: mapped.status });
      }

      // Every profile must carry an access row (guardian-profiles invariant;
      // migration 048 backfilled existing rows, new signups add theirs here).
      // Best-effort until 055's insert-side trigger makes it structural.
      if (supabaseAdmin) {
        const { error: accessError } = await supabaseAdmin
          .from('profile_access')
          .upsert(
            { user_id: data.user.id, profile_id: data.user.id, role: 'owner', granted_by: data.user.id },
            { onConflict: 'user_id,profile_id' }
          );
        if (accessError) {
          console.error('[SIGNUP] owner access row failed:', accessError);
          Sentry.captureException(
            new Error(`signup: owner profile_access insert failed: ${accessError.message}`),
            { extra: { userId: data.user.id } }
          );
        }
      }
    } else {
      console.warn('[SIGNUP] No user data returned from auth signup');
    }

    return NextResponse.json(
      { message: 'Account created successfully', user: data.user },
      { status: 201 }
    );

  } catch (error: unknown) {
    console.error('Signup API error:', error);
    Sentry.captureException(error, { tags: { area: 'signup' } });

    if (error instanceof Error && (error.message?.includes('already registered') || 
        error.message?.includes('already exists') ||
        error.message?.includes('duplicate'))) {
      return NextResponse.json(
        { 
          error: 'There is already an account registered under this email address. Please use a different email or try logging in.' 
        },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}