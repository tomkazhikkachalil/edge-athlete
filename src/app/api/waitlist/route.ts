import { NextRequest, NextResponse } from 'next/server';

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
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address' },
        { status: 400 }
      );
    }

    // For now, just log the waitlist submission
    // In production, you would save this to your database or send to an email service
    console.log('Waitlist submission:', {
      email: email.toLowerCase(),
      userType,
      timestamp: new Date().toISOString(),
      userAgent: request.headers.get('user-agent') || 'unknown'
    });

    // You could also save to a database:
    // await supabaseAdmin.from('waitlist').insert({
    //   email: email.toLowerCase(),
    //   user_type: userType,
    //   created_at: new Date().toISOString()
    // });

    // Or send a notification email:
    // await sendNotificationEmail(
    //   'admin@yourdomain.com',
    //   'New Waitlist Signup',
    //   `New waitlist signup: ${email} wants to be a ${userType}`
    // );

    return NextResponse.json(
      { 
        message: 'Successfully added to waitlist',
        email: email.toLowerCase(),
        userType 
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