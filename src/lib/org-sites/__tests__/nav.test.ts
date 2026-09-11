import { describe, expect, it } from 'vitest';
import { navEntries, type NavPage } from '../nav';
import { pageNavKey, parseNavConfig } from '../validate';

// Program 2, B (Sep 11 2026): the header's one list — modules and pages.

const P1 = '2f1b46c8-2964-4139-9689-d1c3f736ed93';
const P2 = '3a2c57d9-3a75-4240-a79a-e2d4a847fea4';
const P3 = '4b3d68ea-4b86-4351-b8ab-f3e5b958afb5';
const page = (id: string, slug: string, createdAt: string, over: Partial<NavPage> = {}): NavPage => ({ id, slug, title: slug.toUpperCase(), visibility: 'public', inNav: true, createdAt, ...over });
const modules = ['standings', 'schedule', 'teams'];

describe('navEntries', () => {
  it('an untouched site renders exactly today\'s header: the modules, then the pages by creation time', () => {
    const nav = parseNavConfig([{ key: 'standings' }]);
    const out = navEntries(nav, modules, [page(P2, 'b', '2026-09-11T10:00:00Z'), page(P1, 'a', '2026-09-11T09:00:00Z')]);
    expect(out).toEqual([
      { kind: 'module', key: 'standings' },
      { kind: 'module', key: 'schedule' },
      { kind: 'module', key: 'teams' },
      { kind: 'page', slug: 'a', title: 'A' },
      { kind: 'page', slug: 'b', title: 'B' },
    ]);
  });
  it('a listed page takes its stored place among the modules; hidden and draft pages never show; unknown entries are ignored', () => {
    const nav = parseNavConfig([{ key: 'standings' }, { key: pageNavKey(P1) }, { key: 'teams' }, { key: pageNavKey(P3) }, { key: 'nope' }]);
    const out = navEntries(nav, modules, [
      page(P1, 'about', '2026-09-11T09:00:00Z'),
      page(P2, 'hidden', '2026-09-11T10:00:00Z', { inNav: false }),
      page(P3, 'draft', '2026-09-11T11:00:00Z', { visibility: 'draft' }),
    ]);
    expect(out).toEqual([
      { kind: 'module', key: 'standings' },
      { kind: 'page', slug: 'about', title: 'ABOUT' },
      { kind: 'module', key: 'teams' },
      { kind: 'module', key: 'schedule' },
    ]);
  });
  it('a module the caller does not show (disabled) is skipped even when listed; duplicates collapse', () => {
    const nav = parseNavConfig([{ key: 'news' }, { key: 'standings' }, { key: 'standings' }]);
    expect(navEntries(nav, ['standings'], [])).toEqual([{ kind: 'module', key: 'standings' }]);
  });
});
