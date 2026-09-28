import { describe, expect, it } from 'vitest';
import { hasDeepLink, parseEditorDeepLink } from '../deep-link';

describe('parseEditorDeepLink (H2)', () => {
  it('reads open=settings and a section key', () => {
    expect(parseEditorDeepLink('?open=settings')).toEqual({ open: 'settings', section: null });
    expect(parseEditorDeepLink('?section=documents')).toEqual({ open: null, section: 'documents' });
    expect(parseEditorDeepLink('?page=abc&section=contact_form')).toEqual({ open: null, section: 'contact_form' });
  });
  it('anything else is nothing', () => {
    expect(parseEditorDeepLink('?open=theme&section=Docs;drop')).toEqual({ open: null, section: null });
    expect(parseEditorDeepLink('')).toEqual({ open: null, section: null });
    expect(hasDeepLink(parseEditorDeepLink(''))).toBe(false);
    expect(hasDeepLink(parseEditorDeepLink('?open=settings'))).toBe(true);
  });
});
