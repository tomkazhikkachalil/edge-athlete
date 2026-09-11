/**
 * The site header's list — program 2, B (Sep 11 2026). Modules and custom
 * pages in ONE order: `nav_config` entries (module keys and `page:<uuid>`)
 * first, in their stored order; then the unlisted modules in the order the
 * caller already computed (today's rule); then the unlisted public, listed
 * pages by creation time. An untouched site therefore renders EXACTLY the
 * header it rendered before pages joined the list. Pure; no imports beyond
 * the nav parser's types.
 */
import { pageNavKey, type NavConfig } from './validate';

export interface NavPage {
  id: string;
  slug: string;
  title: string;
  visibility: 'public' | 'draft';
  inNav: boolean;
  createdAt: string;
}

export type NavEntry = { kind: 'module'; key: string } | { kind: 'page'; slug: string; title: string };

export function navEntries(nav: Pick<NavConfig, 'entries'>, moduleKeys: readonly string[], pages: readonly NavPage[]): NavEntry[] {
  const shown = pages.filter(p => p.visibility === 'public' && p.inNav);
  const byKey = new Map(shown.map(p => [pageNavKey(p.id), p] as const));
  const out: NavEntry[] = [];
  const seen = new Set<string>();
  for (const key of nav.entries) {
    if (seen.has(key)) continue;
    const page = byKey.get(key);
    if (page) {
      out.push({ kind: 'page', slug: page.slug, title: page.title });
      seen.add(key);
    } else if (moduleKeys.includes(key)) {
      out.push({ kind: 'module', key });
      seen.add(key);
    }
  }
  for (const key of moduleKeys) {
    if (seen.has(key)) continue;
    out.push({ kind: 'module', key });
    seen.add(key);
  }
  const rest = shown.filter(p => !seen.has(pageNavKey(p.id))).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
  for (const p of rest) out.push({ kind: 'page', slug: p.slug, title: p.title });
  return out;
}
