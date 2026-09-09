import type { PublicCoursePhoto } from './validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';

/**
 * Course + hole photos for the in-app Courses card (Org Pages R4): the
 * console's `courses` module config, already parsed by `parseCoursePhotos`,
 * with every path mapped through the prefix-re-asserting URL helper. A path
 * outside this site's prefix is dropped; a course with neither a photo nor
 * any surviving hole photo is omitted. Pure; node-tested.
 */
export interface AppCoursePhotos {
  photo?: { url: string; alt: string };
  holes?: Record<number, { url: string; alt: string }>;
}

export function coursePhotoUrls(
  siteId: string,
  parsed: Record<string, PublicCoursePhoto>
): Record<string, AppCoursePhotos> {
  const out: Record<string, AppCoursePhotos> = {};
  for (const [courseId, entry] of Object.entries(parsed)) {
    const item: AppCoursePhotos = {};
    const photoUrl = orgMediaUrl(siteId, entry.path);
    if (photoUrl) item.photo = { url: photoUrl, alt: entry.alt ?? '' };
    if (entry.holes) {
      const holes: Record<number, { url: string; alt: string }> = {};
      for (const [n, hole] of Object.entries(entry.holes)) {
        const url = orgMediaUrl(siteId, hole?.path);
        const num = Number(n);
        if (url && Number.isInteger(num) && num >= 1 && num <= 18) holes[num] = { url, alt: hole.alt ?? '' };
      }
      if (Object.keys(holes).length > 0) item.holes = holes;
    }
    if (item.photo || item.holes) out[courseId] = item;
  }
  return out;
}
