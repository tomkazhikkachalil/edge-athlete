import { notFound } from 'next/navigation';
import { getCachedSite } from '@/lib/org-sites/cached';
import type { PublicSite } from '@/lib/org-sites/server';

/** Subpage gate: the site must be published AND the module enabled —
 *  disabled modules don't exist (the R1 rule), so their subpages 404.
 *  Reads the same cached site entry as the layout, so a console toggle
 *  + revalidateTag flips home and subpages together. */
export async function requireSiteModule(slug: string, key: string): Promise<PublicSite> {
  const site = await getCachedSite(slug);
  if (!site || !site.modules.some(m => m.module_key === key && m.enabled)) notFound();
  return site;
}
