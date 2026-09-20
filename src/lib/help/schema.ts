import { z } from 'zod';
import { boundedText, optionalText } from '@/lib/validation';
import { HELP_LIMITS, HELP_TOPICS } from './types';

/** The admin article body (Spec 3) — shared by POST (whole) and PATCH (partial). */
export const ArticleBody = z.object({
  title: boundedText(HELP_LIMITS.title),
  body: z.string().max(HELP_LIMITS.body).default(''),
  topic: z.enum(HELP_TOPICS),
  video_url: optionalText(500).nullable().default(null),
  sort_order: z.number().int().min(0).max(10_000).default(100),
  published: z.boolean().default(false),
  slug: optionalText(HELP_LIMITS.slug),
});
