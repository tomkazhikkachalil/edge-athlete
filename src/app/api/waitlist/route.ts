import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { emailService } from '@/lib/email-service';
import { parseBody, emailString } from '@/lib/validation';
import { enforceRateLimit } from '@/lib/rate-limit';

// Landing-page values ('Club', 'League'…) arrive mixed-case → normalize.
const WaitlistSchema = z.object({
  email: emailString,
  userType: z
    .string()
    .transform(s => s.trim().toLowerCase())
    .pipe(z.enum(['club', 'league', 'fan', 'guest'])),
});

export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, 'waitlist');
    if (limited) return limited;

    const parsed = await parseBody(request, WaitlistSchema);
    if (!parsed.success) return parsed.response;
    const { email: normalizedEmail, userType: normalizedType } = parsed.data;

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
