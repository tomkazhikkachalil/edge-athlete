/**
 * The site header's list — program 2, B (Sep 11 2026). Modules and custom
 * pages in ONE order. The MODULES keep the order the caller computed (the
 * rows' sort_order — today's rule; `nav_config` mirrors it and carries the
 * labels, and `reset_order` clears it while the rows re-sort). A listed
 * page takes its place from `nav_config`: it goes before the next module
 * that follows it in the stored entries; a page with no module after it
 * sits after the last module. Unlisted public pages follow, by creation
 * time. An untouched site therefore renders EXACTLY the header it rendered
 * before pages joined the list. Pure; no imports beyond the nav parser.
 */
import { isPageNavKey, pageNavKey, type NavConfig } from './validate';

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
  // The module spine, deduped, in the caller's order.
  const spine: string[] = [];
  for (const key of moduleKeys) if (!spine.includes(key)) spine.push(key);
  // Each listed page → the module it precedes (the next module key after it
  // in the stored entries that the spine holds), or null = after the last.
  const before = new Map<string, NavPage[]>();
  const tail: NavPage[] = [];
  const placed = new Set<string>();
  nav.entries.forEach((key, i) => {
    if (!isPageNavKey(key)) return;
    const page = byKey.get(key);
    if (!page || placed.has(key)) return;
    placed.add(key);
    const next = nav.entries.slice(i + 1).find(k => !isPageNavKey(k) && spine.includes(k));
    if (next) before.set(next, [...(before.get(next) ?? []), page]);
    else tail.push(page);
  });
  const out: NavEntry[] = [];
  for (const key of spine) {
    for (const page of before.get(key) ?? []) out.push({ kind: 'page', slug: page.slug, title: page.title });
    out.push({ kind: 'module', key });
  }
  for (const page of tail) out.push({ kind: 'page', slug: page.slug, title: page.title });
  const rest = shown.filter(p => !placed.has(pageNavKey(p.id))).sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id.localeCompare(b.id)));
  for (const p of rest) out.push({ kind: 'page', slug: p.slug, title: p.title });
  return out;
}
