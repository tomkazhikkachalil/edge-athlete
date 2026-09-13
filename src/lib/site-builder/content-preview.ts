import type { ContentSource } from './config';

/**
 * The live content preview — Site Builder program 3, H3 (Sep 13 2026).
 *
 * Instance options always previewed at once (the canvas renders the
 * layout under edit). CONTENT — the hero, the contact card, the sponsors
 * list — lives on the org objects and used to reach the canvas only after
 * "Save content". The panel now emits what is typed as it is typed and the
 * editor lays it over the site AT THE RENDER BOUNDARY (the same seam the
 * sample overlay uses): the canvas re-renders on each keystroke; the real
 * site, the draft PUT and the PATCH are untouched until the explicit save.
 * The render parsers decide what shows (a half-typed email is dropped by
 * `parseContact` until it is one — honest, and exactly what the save would
 * store). Pure; the same site reference comes back when there is no
 * preview.
 */
export type ContentPreview = { key: 'hero'; value: Record<string, unknown> } | { key: 'contact'; value: Record<string, unknown> } | { key: 'sponsors'; value: { sponsors: Record<string, unknown>[] } };

export function applyContentPreview<S extends ContentSource>(site: S, preview: ContentPreview | null): S {
  if (!preview) return site;
  switch (preview.key) {
    case 'hero':
      return { ...site, hero_config: preview.value };
    case 'contact':
      return { ...site, contact_config: preview.value };
    case 'sponsors': {
      const has = site.modules.some(m => m.module_key === 'sponsors');
      const modules = has
        ? site.modules.map(m => (m.module_key === 'sponsors' ? { ...m, config: { ...(m.config && typeof m.config === 'object' ? (m.config as Record<string, unknown>) : {}), sponsors: preview.value.sponsors } } : m))
        : [...site.modules, { module_key: 'sponsors', enabled: true, sort_order: site.modules.length, config: { sponsors: preview.value.sponsors } } as unknown as S['modules'][number]];
      return { ...site, modules };
    }
  }
}
