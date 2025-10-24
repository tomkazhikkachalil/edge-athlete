import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { apiRateLimiter } from '@/lib/rate-limit';

/**
 * Generic AI text processing endpoint
 * 
 * IMPORTANT: This uses OpenAI's new Responses API (responses.create) which is 
 * their latest API service. This is NOT the older chat completions API.
 * 
 * The model 'gpt-4.1-mini' is OpenAI's newest model as of 2025.
 * Do not change this to gpt-4o-mini or gpt-4 - those are older models.
 * 
 * Modify the instructions and prompt for your use case.
 */
export async function POST(request: NextRequest) {
  try {
    // Get IP for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitCheck = apiRateLimiter.check(ip, 'ai-text');
    
    if (!rateLimitCheck.allowed) {
      return NextResponse.json(
        { error: 'Too many requests. Please try again later.' },
        { status: 429 }
      );
    }
    
    // Check if API key is available
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'OpenAI API key is missing' },
        { status: 500 }
      );
    }

    // Initialize OpenAI client
    const openai = new OpenAI({ apiKey });
    
    // Parse request body
    const { text } = await request.json();

    // Validate input
    if (!text || typeof text !== 'string') {
      return NextResponse.json(
        { error: 'Text is required' },
        { status: 400 }
      );
    }

    // Create prompt for your use case
    const prompt = `Process this text: ${text}`;

    // Call OpenAI API using responses.create
    const response = await openai.responses.create({
      model: 'gpt-4.1-mini',
      instructions: 'You are a helpful AI assistant. Process the user input and provide a thoughtful response.',
      input: prompt,
      temperature: 0.7
    });

    const processedText = response.output_text ?? '';


    return NextResponse.json({ processedText });

  } catch (error) {
    if (error instanceof Response) {
      return error;
    }
    return NextResponse.json(
      { error: 'Failed to process text' },
      { status: 500 }
    );
  }
}
