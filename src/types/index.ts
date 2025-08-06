/**
 * Custom type definitions
 * 
 * Use this file for:
 * - API request/response types
 * - Form data interfaces
 * - Component props
 * - External API types
 * - UI state types
 */

// AI API types
export interface AITextRequest {
  text: string;
}

export interface AITextResponse {
  response: string;
  message: string;
}

export interface AIImageRequest {
  image: string; // base64 encoded
}

export interface AIImageResponse {
  analysis: string;
  message: string;
}

// Contact form types
export interface ContactFormRequest {
  name: string;
  email: string;
  message: string;
}

export interface ContactFormResponse {
  message: string;
  success: boolean;
}

// Add your custom types below