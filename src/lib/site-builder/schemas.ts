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
import { INSTANCE_TITLE_MAX } from './config';
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
import { FORM_INTRO_MAX, FORM_THANKS_MAX, IMAGE_ALT_MAX, IMAGE_CAPTION_MAX, TEXT_WIDGET_BLOCKS_MAX } from './fields';

export { IMAGE_ALT_MAX, IMAGE_CAPTION_MAX, TEXT_WIDGET_BLOCKS_MAX };

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

/** Phase 9 — an instance's QUERY: which competition / venue this tile shows
 *  and how many rows. Applied render-side on the org-wide reads
 *  (select.ts). ONE nested key on purpose: content (the org objects) wins
 *  over instance options at the top level of effectiveConfig, and no org
 *  object writes a key named `query`. Loose: a future key (teamId) round-
 *  trips through PUT draft. */
export const QUERY_LIMIT_MAX = 50;
export const QuerySchema = z
  .object({
    competitionId: z.uuid().optional(),
    venueId: z.uuid().optional(),
    limit: z.number().int().min(1).max(QUERY_LIMIT_MAX).optional(),
  })
  .loose();

/** Phase 5 — the INSTANCE's own options (never content): the title
 *  override; phase 9: the query. Loose: content keys a legacy layout copied
 *  onto an instance survive (effectiveConfig lets the org object win over
 *  them at render). */
export const InstanceOptionsSchema = z
  .object({
    title: z.string().trim().max(INSTANCE_TITLE_MAX).optional(),
    query: QuerySchema.optional(),
  })
  .loose();

// ── Content widgets (phase 6) — the INSTANCE carries the content ────────────
// Text, image and embed have no module row and no org object of their own:
// what they show rides the layout instance, under the publish gate with the
// placement (a draft paragraph never goes live before Publish; Restore
// brings the words back). Each schema is the options schema PLUS the
// widget's content; `instanceSchemaFor` is what `PUT draft` validates with.

/** The text widget's STORED blocks — the page block vocabulary (heading,
 *  paragraph, link-list, image) with LENIENT strings: the panel binds the
 *  editor straight to the instance, and a paragraph being typed is empty
 *  for a moment; the autosave must not 400 on it. The render path is the
 *  strict one (`parsePageBody` drops what is not yet a block), so a
 *  half-typed block never shows and an all-blank widget counts as empty. */
export const TextBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('heading'), text: z.string().max(120) }),
  z.object({ type: z.literal('paragraph'), text: z.string().max(2000) }),
  z.object({
    type: z.literal('image'),
    path: z.string().regex(ORG_MEDIA_PATH_RE, 'Not a site asset path'),
    alt: z.string().max(200),
    width: z.number().int().positive().max(10000).optional(),
    height: z.number().int().positive().max(10000).optional(),
  }),
  z.object({
    type: z.literal('link-list'),
    links: z.array(z.object({ label: z.string().max(80), url: z.string().trim().max(200) })).max(20),
  }),
]);

/** The text widget: its blocks, capped shorter than a page (≤ 12) so a
 *  layout stays a few KB. `PageBlockSchema` (validate.ts) is the strict
 *  twin the renderer parses with. */
export const TextWidgetSchema = InstanceOptionsSchema.extend({
  blocks: z.array(TextBlockSchema).max(TEXT_WIDGET_BLOCKS_MAX).optional(),
});

/** One photo from the site's own assets (the server re-asserts the site
 *  prefix — the schema cannot know the site id), with alt, caption, link
 *  and the intrinsic size measured at upload. The link is stored as typed
 *  (a half-typed address must not fail the autosave); the renderer shows
 *  it only once it is an https:// address. */
export const ImageWidgetSchema = InstanceOptionsSchema.extend({
  path: z.string().regex(ORG_IMAGE_PATH_RE, 'Not a site image').optional(),
  alt: z.string().trim().max(IMAGE_ALT_MAX).optional(),
  caption: z.string().trim().max(IMAGE_CAPTION_MAX).optional(),
  href: z.string().trim().max(200).optional(),
  width: z.number().int().positive().max(10000).optional(),
  height: z.number().int().positive().max(10000).optional(),
});

const coord = z.number().finite();
/** The structured embed (embeds.ts parses a pasted link into this; the
 *  renderer rebuilds the frame src from it — never from a stored URL). */
export const EmbedSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('youtube'), id: z.string().regex(/^[A-Za-z0-9_-]{11}$/) }),
  z.object({ provider: z.literal('vimeo'), id: z.string().regex(/^[0-9]{6,12}$/) }),
  z.object({
    provider: z.literal('osm'),
    bbox: z.tuple([coord.min(-180).max(180), coord.min(-90).max(90), coord.min(-180).max(180), coord.min(-90).max(90)]),
    marker: z.tuple([coord.min(-90).max(90), coord.min(-180).max(180)]).optional(),
  }),
]);

export const EmbedWidgetSchema = InstanceOptionsSchema.extend({
  embed: EmbedSchema.optional(),
});

/** What a layout INSTANCE's config may hold, per widget: options only for
 *  module widgets (their content lives on the org objects); options plus
 *  content for the content widgets. */
/** Program 2, D: a form widget's instance — the intro and the thank-you line. */
export const FormWidgetSchema = InstanceOptionsSchema.extend({
  intro: z.string().trim().max(FORM_INTRO_MAX).optional(),
  thanks: z.string().trim().max(FORM_THANKS_MAX).optional(),
});

export function instanceSchemaFor(key: WidgetKey): z.ZodType {
  switch (key) {
    case 'contact_form':
    case 'interest_form':
      return FormWidgetSchema;
    case 'text':
      return TextWidgetSchema;
    case 'image':
      return ImageWidgetSchema;
    case 'embed':
      return EmbedWidgetSchema;
    default:
      return InstanceOptionsSchema;
  }
}

/** The site-asset image paths an instance's (already-parsed) config refers
 *  to — the server checks each against THIS site's org-media prefix. */
export function instanceImagePaths(key: WidgetKey, config: unknown): string[] {
  const c = config && typeof config === 'object' ? (config as Record<string, unknown>) : {};
  if (key === 'image') return typeof c.path === 'string' ? [c.path] : [];
  if (key === 'text' && Array.isArray(c.blocks)) {
    return c.blocks
      .filter((b): b is { type: 'image'; path: string } => !!b && typeof b === 'object' && (b as { type?: unknown }).type === 'image' && typeof (b as { path?: unknown }).path === 'string')
      .map(b => b.path);
  }
  return [];
}




