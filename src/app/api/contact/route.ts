import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { emailService } from '@/lib/email-service';
import { enforceRateLimit } from '@/lib/rate-limit';
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

    // Check if email is configured
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
      return NextResponse.json(
        { error: 'Email service is not configured.' },
        { status: 500 }
      );
    }

    // Send email (schema already trimmed + lowercased the email)
    await emailService.sendContactEmail({ name, email, message });

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