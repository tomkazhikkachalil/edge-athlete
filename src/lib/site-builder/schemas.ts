/**
 * Per-widget config schemas — Site Builder phase 1 (Sep 9 2026).
 *
 * The typed shape of each widget's STORED config: what `deriveLegacyLayout`
 * puts on an instance (hero_config, contact_config, a module row's config)
 * and what the defensive render-side parsers in validate.ts already accept.
 * They describe the stored object — not the console's PATCH payloads, which
 * stay in `SitePatchSchema` untouched — so a config that round-trips through
 * `parseSponsors` / `parseDocuments` / `parseContact` / `parseHeroConfig`
 * always parses here (pinned by schemas.test.ts). Objects are LOOSE: stored
 * configs carry keys older or newer than this build (the gallery config, for
 * one, is merged not replaced), and a widget must never lose them.
 *
 * SERVER / CONSOLE ONLY — this file imports zod and validate.ts; the
 * client-side registry (`catalog.ts`) deliberately does not. Phase 5's
 * schema-generated properties panel and phase 3's `PUT draft` validation are
 * the consumers; phase 1 ships the shapes and the parse helper.
 */

import { z } from 'zod';
import {
  CONTACT_ADDRESS_LINES,
  CONTACT_ADDRESS_LINE_MAX,
  CONTACT_HOURS_MAX,
  HERO_CTA_LABEL_MAX,
  HERO_IMAGE_ALT_MAX,
  HERO_NOTICE_MAX,
  HOLE_PHOTO_MAX_HOLE,
  ISO_DAY_RE,
  ORG_DOCUMENT_PATH_RE,
  ORG_IMAGE_PATH_RE,
  ORG_MEDIA_PATH_RE,
  httpsUrl,
} from '@/lib/org-sites/validate';
import type { WidgetKey } from './catalog';

const text = (max: number) => z.string().max(max);

export const HeroConfigSchema = z
  .object({
    headline: text(80).optional(),
    tagline: text(140).optional(),
    imagePath: z.string().regex(ORG_IMAGE_PATH_RE).optional(),
    imageAlt: text(HERO_IMAGE_ALT_MAX).optional(),
    ctaLabel: text(HERO_CTA_LABEL_MAX).optional(),
    ctaUrl: httpsUrl.optional(),
    notice: text(HERO_NOTICE_MAX).optional(),
    noticeUntil: z.string().regex(ISO_DAY_RE).optional(),
  })
  .loose();

export const SponsorsConfigSchema = z
  .object({
    sponsors: z
      .array(
        z
          .object({
            name: text(80),
            url: httpsUrl.optional(),
            logoPath: z.string().regex(ORG_MEDIA_PATH_RE).optional(),
          })
          .loose()
      )
      .max(20)
      .optional(),
  })
  .loose();

export const DocumentsConfigSchema = z
  .object({
    documents: z
      .array(
        z
          .object({
            title: text(80),
            path: z.string().regex(ORG_DOCUMENT_PATH_RE).optional(),
            url: httpsUrl.optional(),
          })
          .loose()
      )
      .max(20)
      .optional(),
  })
  .loose();

export const ContactConfigSchema = z
  .object({
    email: z.string().max(200).optional(),
    phone: z.string().max(40).optional(),
    website: httpsUrl.optional(),
    address: z.array(text(CONTACT_ADDRESS_LINE_MAX)).max(CONTACT_ADDRESS_LINES).optional(),
    hours: text(CONTACT_HOURS_MAX).optional(),
    directionsUrl: httpsUrl.optional(),
    social: z
      .object({
        instagram: httpsUrl.optional(),
        facebook: httpsUrl.optional(),
        x: httpsUrl.optional(),
        youtube: httpsUrl.optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** The gallery module's curated member-round picks (program 10 M2). */
export const GalleryConfigSchema = z
  .object({
    picks: z
      .array(
        z
          .object({
            mediaId: z.uuid(),
            postId: z.uuid().optional(),
            profileId: z.uuid().optional(),
            addedAt: z.string().optional(),
          })
          .loose()
      )
      .optional(),
  })
  .loose();

const CoursePhotoSchema = z
  .object({
    path: z.string().regex(ORG_IMAGE_PATH_RE).optional(),
    alt: text(HERO_IMAGE_ALT_MAX).optional(),
  })
  .loose();

/** The courses module's per-course photos (S2/N6), as `set_course_photo`
 *  stores them: `{ photos: { [courseId]: { path?, alt?, holes?: { [1..18]:
 *  { path, alt? } } } } }`. (P1-B modelled the map at the top level — a
 *  misread of the writer, corrected in P2-A before any consumer existed.) */
export const CoursesConfigSchema = z
  .object({
    photos: z
      .record(
        z.uuid(),
        CoursePhotoSchema.extend({
          holes: z
            .record(
              z.string().refine(k => {
                const n = Number(k);
                return Number.isInteger(n) && n >= 1 && n <= HOLE_PHOTO_MAX_HOLE;
              }),
              CoursePhotoSchema
            )
            .optional(),
        })
      )
      .optional(),
  })
  .loose();

/** Widgets with a typed config. Every other widget's config is `{}`. */
export const WIDGET_CONFIG_SCHEMAS: Partial<Record<WidgetKey, z.ZodType>> = {
  hero: HeroConfigSchema,
  sponsors: SponsorsConfigSchema,
  documents: DocumentsConfigSchema,
  contact: ContactConfigSchema,
  gallery: GalleryConfigSchema,
  courses: CoursesConfigSchema,
};

const EmptyConfigSchema = z.record(z.string(), z.unknown());

export function widgetConfigSchema(key: WidgetKey): z.ZodType {
  return WIDGET_CONFIG_SCHEMAS[key] ?? EmptyConfigSchema;
}

/** Defensive: an unusable stored config becomes `{}` rather than a throw
 *  (the readers-never-throw rule of the (public) segment). */
export function parseWidgetConfig(key: WidgetKey, raw: unknown): Record<string, unknown> {
  const result = widgetConfigSchema(key).safeParse(raw ?? {});
  return result.success ? (result.data as Record<string, unknown>) : {};
}
