import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailService } from '@/lib/email-service';
import { enforceRateLimit } from '@/lib/rate-limit';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { parseBody, emailString, boundedText } from '@/lib/validation';

const ContactSchema = z.object({
  name: boundedText(100),
  email: emailString,
  message: boundedText(5000),
});

/**
 * Contact form API endpoint
 * 
 * Simple endpoint for students to build contact forms.
 * No auth required, just basic rate limiting.
 */
export async function POST(request: NextRequest) {
  try {
    const limited = await enforceRateLimit(request, 'contact');
    if (limited) return limited;

    // Parse + validate request body (zod)
    const parsed = await parseBody(request, ContactSchema);
    if (!parsed.success) return parsed.response;
    const { name, email, message } = parsed.data;

    // Persist FIRST (096) — the row is the source of truth. The email is
    // best-effort on top: a broken mail pipe must never eat a support
    // message from exactly the people an email outage locks out.
    const admin = getSupabaseAdmin();
    const { data: saved, error: insertError } = await admin
      .from('contact_messages')
      .insert({ name, email, message })
      .select('id')
      .single();
    if (insertError || !saved) {
      console.error('Contact form persist error:', insertError);
      return NextResponse.json(
        { error: 'Failed to send message. Please try again later.' },
        { status: 500 }
      );
    }

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
      const delivered = await emailService.sendContactEmail({ name, email, message });
      if (delivered) {
        await admin.from('contact_messages').update({ delivered: true }).eq('id', saved.id);
      }
    }

    return NextResponse.json({
      message: 'Message sent successfully! We\'ll get back to you soon.',
      success: true,
    });

  } catch (error) {
    console.error('Contact form error:', error);
    
    return NextResponse.json(
      { error: 'Failed to send message. Please try again later.' },
      { status: 500 }
    );
  }
}