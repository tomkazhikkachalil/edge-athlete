import { z } from 'zod';
import { NextResponse } from 'next/server';

// ── Shared request-body validation (zod) ──────────────────────────────────────
// One consistent way to validate + parse an API request body. Adopt
// incrementally, route by route:
//
//   const parsed = await parseBody(request, MySchema);
//   if (!parsed.success) return parsed.response;   // 400 with field errors
//   const { field } = parsed.data;                 // typed + validated
//
// Schemas are written to MATCH each route's existing accepted-input behavior,
// never to tighten it silently (that would 400 valid production traffic).

// ── Reusable primitives ───────────────────────────────────────────────────────
export const uuid = z.string().uuid();

/** Trimmed, non-empty string with a max length. */
export const boundedText = (max: number) =>
  z.string().trim().min(1).max(max);

/** Optional text that normalizes '' / whitespace / undefined → undefined. */
export const optionalText = (max: number) =>
  z
    .string()
    .max(max)
    .transform(s => s.trim())
    .optional()
    .or(z.literal('').transform(() => undefined));

export const emailString = z
  .string()
  .trim()
  .toLowerCase()
  .max(320)
  .email();

type ParseResult<T> =
  | { success: true; data: T }
  | { success: false; response: NextResponse };

/**
 * Parse + validate a JSON request body against a schema. On failure returns a
 * ready-to-return 400 with the first field error (never throws).
 */
export async function parseBody<T>(
  request: Request,
  schema: z.ZodType<T>
): Promise<ParseResult<T>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      success: false,
      response: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    const message = first ? `${path ? path + ': ' : ''}${first.message}` : 'Invalid request body';
    return {
      success: false,
      response: NextResponse.json({ error: message }, { status: 400 }),
    };
  }

  return { success: true, data: result.data };
}
