import type { PublicGalleryItem } from './public-data';

/**
 * The in-app gallery's order (Org Pages R4, Sep 8 2026). The public site's
 * `fetchPublicGallery` returns members' round photos first (newest pick
 * first) and then contest media — two lists, not one timeline. The in-app
 * Photos bubble is one timeline: newest first by date, members' round
 * photos before contest items on the same date, undated items last, and
 * STABLE (equal keys keep their input order). Pure; node-tested.
 */
export function orderGalleryForApp(items: PublicGalleryItem[]): PublicGalleryItem[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const da = a.item.date ?? '';
      const db = b.item.date ?? '';
      if (da !== db) {
        if (!da) return 1;
        if (!db) return -1;
        return da < db ? 1 : -1;
      }
      const ka = a.item.kind === 'member' ? 0 : 1;
      const kb = b.item.kind === 'member' ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return a.index - b.index;
    })
    .map(({ item }) => item);
}
