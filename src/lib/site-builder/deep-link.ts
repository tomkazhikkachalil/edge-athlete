// The editor's deep links (sports-team website program, H2, Sep 27 2026).
// The console's Website section points INTO the editor for everything the
// editor owns now (one home): `?open=settings` opens Settings (logo, SEO,
// footer, subpages & navigation); `?section=<widget key>` selects the first
// section of that kind (documents, gallery, sponsors …). `?page=` (program
// 2) is read by the loader itself. Pure, zero imports.

export interface EditorDeepLink {
  open: 'settings' | null;
  /** A widget key shape only — the editor looks it up in the layout. */
  section: string | null;
}

const SECTION_RE = /^[a-z][a-z_]{1,31}$/;

export function parseEditorDeepLink(search: string): EditorDeepLink {
  const params = new URLSearchParams(search);
  const open = params.get('open') === 'settings' ? 'settings' : null;
  const raw = params.get('section');
  return { open, section: raw && SECTION_RE.test(raw) ? raw : null };
}

export function hasDeepLink(link: EditorDeepLink): boolean {
  return link.open !== null || link.section !== null;
}
