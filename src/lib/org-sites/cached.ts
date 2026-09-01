import { unstable_cache } from 'next/cache';
import { getSupabaseAdmin } from '@/lib/auth-server';
import { getPublicSiteBySlug, type PublicSite } from './server';

// The (public) segment's per-slug cached site read: unstable_cache with
// the `org-site:{slug}` tag (console writes revalidateTag it) + the 300s
// baseline. Layout and page share one entry per render via the cache key.
export const getCachedSite = (slug: string): Promise<PublicSite | null> =>
  unstable_cache(
    () => getPublicSiteBySlug(getSupabaseAdmin(), slug),
    ['org-site', slug],
    { tags: [`org-site:${slug}`], revalidate: 300 }
  )();
