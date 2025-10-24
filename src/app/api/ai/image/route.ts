import { NextRequest, NextResponse } from 'next/server';
import { OpenAI } from 'openai';
import { apiRateLimiter } from '@/lib/rate-limit';

/**
 * Generic AI image processing endpoint
 * 
 * This template uses OpenAI's chat completions API with vision capabilities.
 * 
 * IMPORTANT: The model 'gpt-4.1-mini' is OpenAI's newest model as of 2025
 * with vision support. Do not change this to gpt-4o-mini, gpt-4-vision, 
 * or gpt-4 - those are older models.
 * 
 * Expects a base64 encoded image in the request body.
 */
export async function POST(request: NextRequest) {
  try {
    // Get IP for rate limiting
    const ip = request.headers.get('x-forwarded-for') || 'unknown';
    const rateLimitCheck = apiRateLimiter.check(ip, 'ai-image');
    
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
    const { image } = await request.json();

    // Validate input
    if (!image) {
      return NextResponse.json(
        { error: 'Base64 image is required' },
        { status: 400 }
      );
    }

    // Process the image with OpenAI
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: "You are an AI assistant that analyzes images and provides helpful descriptions."
        },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Please analyze this image and describe what you see."
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${image}`
              }
            }
          ]
        }
      ],
      max_tokens: 500
    });

    const analysis = completion.choices[0].message.content;

    return NextResponse.json({
      analysis,
      message: 'Image analyzed successfully'
    });

  } catch (error) {
    console.error('Image processing error:', error);
    
    return NextResponse.json(
      { error: 'Failed to process image' },
      { status: 500 }
    );
  }
}