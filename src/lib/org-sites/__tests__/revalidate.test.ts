import { describe, expect, it, vi } from 'vitest';

vi.mock('next/cache', () => ({ revalidateTag: vi.fn() }));

import { composeBrandSources } from '../revalidate';
import { SNAPSHOT_VERSION } from '@/lib/site-builder/snapshot';
import { seedLayout } from '@/lib/site-builder/seeds';

// Hardening H3: which snapshot feeds the in-app brand and the in-app
// COMPOSITION. The brand may come from the draft while the site is offline
// (Tom's rule); the layout comes from the PUBLISHED revision only — a draft
// paragraph never renders in-app before Publish.

const base = { v: SNAPSHOT_VERSION, templateId: 'classic', theme: {}, hero: {}, nav: [], contact: {}, modules: {} };
const layoutOf = (keys: string[]) => seedLayout({ template_id: 'classic', hero_config: {}, contact_config: {}, visibility: 'public', modules: keys.map((k, i) => ({ module_key: k, enabled: true, sort_order: i, config: {} })) });
const draft = { ...base, hero: { headline: 'Draft words' }, theme: { accent: '#0f766e' }, layout: layoutOf(['hero', 'standings', 'news']) };
const published = { ...base, hero: { headline: 'Live words' }, theme: {}, layout: layoutOf(['hero', 'standings']) };

describe('composeBrandSources', () => {
  it('OFFLINE with a draft: the draft’s hero + theme; the layout is the PUBLISHED one (or null)', () => {
    const noPublished = composeBrandSources({ published_at: null, draft, published: null });
    expect(noPublished.hero).toEqual({ headline: 'Draft words' });
    expect(noPublished.theme).toEqual({ accent: '#0f766e' });
    expect(noPublished.layout).toBeNull();
    const withPublished = composeBrandSources({ published_at: null, draft, published });
    expect(withPublished.hero).toEqual({ headline: 'Draft words' });
    expect(withPublished.layout?.widgets.map(w => w.key)).toEqual(['hero', 'standings']);
  });

  it('OFFLINE with the draft discarded: the rows’ brand (undefined = keep the row) and the published layout', () => {
    const out = composeBrandSources({ published_at: null, draft: null, published });
    expect(out.hero).toBeUndefined();
    expect(out.theme).toBeUndefined();
    expect(out.layout?.widgets.map(w => w.key)).toEqual(['hero', 'standings']);
  });

  it('LIVE: the rows’ brand and the published layout; the draft is ignored entirely', () => {
    const out = composeBrandSources({ published_at: '2026-09-09T00:00:00.000Z', draft, published });
    expect(out.hero).toBeUndefined();
    expect(out.theme).toBeUndefined();
    expect(out.layout?.widgets.map(w => w.key)).toEqual(['hero', 'standings']);
    expect(composeBrandSources({ published_at: '2026-09-09T00:00:00.000Z', draft, published: null }).layout).toBeNull();
  });

  it('a published snapshot without a stored layout (pre-grid) yields null, never the draft’s', () => {
    const preGrid = { ...published, layout: undefined };
    expect(composeBrandSources({ published_at: null, draft, published: preGrid }).layout).toBeNull();
  });
});
