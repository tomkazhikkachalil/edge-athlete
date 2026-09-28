import { describe, expect, it } from 'vitest';
import { hasDeepLink, parseEditorDeepLink } from '../deep-link';

describe('parseEditorDeepLink (H2)', () => {
  it('reads open=settings and a section key', () => {
    expect(parseEditorDeepLink('?open=settings')).toEqual({ open: 'settings', section: null, news: null });
    expect(parseEditorDeepLink('?section=documents')).toEqual({ open: null, section: 'documents', news: null });
    expect(parseEditorDeepLink('?page=abc&section=contact_form')).toEqual({ open: null, section: 'contact_form', news: null });
  });
  it('anything else is nothing', () => {
    expect(parseEditorDeepLink('?open=theme&section=Docs;drop&news=../x')).toEqual({ open: null, section: null, news: null });
    expect(parseEditorDeepLink('')).toEqual({ open: null, section: null, news: null });
    expect(hasDeepLink(parseEditorDeepLink(''))).toBe(false);
    expect(hasDeepLink(parseEditorDeepLink('?open=settings'))).toBe(true);
  });
  it('N4: ?news= opens the newsroom — a post id, new, or the list', () => {
    expect(parseEditorDeepLink('?news=new').news).toBe('new');
    expect(parseEditorDeepLink('?news=list').news).toBe('list');
    expect(parseEditorDeepLink('?news=0b0c7a52-1d3e-4f5a-9b8c-7d6e5f4a3b2c').news).toBe('0b0c7a52-1d3e-4f5a-9b8c-7d6e5f4a3b2c');
    expect(hasDeepLink(parseEditorDeepLink('?news=new'))).toBe(true);
  });
});
