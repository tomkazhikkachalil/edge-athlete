import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { emailService } from '@/lib/email-service';

// Landing-page values ('Club', 'League'…) normalize to these
const VALID_USER_TYPES = ['club', 'league', 'fan', 'guest'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, userType } = body;

    if (!email || !userType) {
      return NextResponse.json(
        { error: 'Email and user type are required' },
        { status: 400 }
      );
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = String(email).trim().toLowerCase();
    if (normalizedEmail.length > 320 || !emailRegex.test(normalizedEmail)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    const normalizedType = String(userType).trim().toLowerCase();
    if (!VALID_USER_TYPES.includes(normalizedType)) {
      return NextResponse.json(
        { error: 'Invalid user type' },
        { status: 400 }
      );
    }

    // Persist. Duplicate (email, user_type) is a friendly no-op — the person
    // is already on the list, so tell them it worked.
    const supabase = getSupabaseAdmin();
    const { error: insertError } = await supabase
      .from('waitlist')
      .insert({ email: normalizedEmail, user_type: normalizedType });

    if (insertError && insertError.code !== '23505') {
      console.error('Waitlist insert error:', insertError);
      return NextResponse.json(
        { error: 'Could not join the waitlist right now. Please try again.' },
        { status: 500 }
      );
    }

    const isNewSignup = !insertError;

    // Best-effort owner notification — only for NEW signups and only when
    // SMTP is configured. Never fails the request.
    if (isNewSignup && process.env.SMTP_USER && process.env.SMTP_PASS) {
      try {
        await emailService.sendWaitlistNotification(normalizedEmail, normalizedType);
      } catch (emailError) {
        console.error('Waitlist notification email failed (non-fatal):', emailError);
      }
    }

    return NextResponse.json(
      {
        message: 'Successfully added to waitlist',
        email: normalizedEmail,
        userType: normalizedType,
      },
      { status: 201 }
    );
  } catch (error: unknown) {
    console.error('Waitlist API error:', error);
    return NextResponse.json(
      { error: 'An unexpected error occurred' },
      { status: 500 }
    );
  }
}
