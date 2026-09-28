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
  /** N4: `?news=<post id>` opens the post in the newsroom; `?news=new` a new
   *  one; `?news=list` the list. */
  news: string | null;
}

const SECTION_RE = /^[a-z][a-z_]{1,31}$/;
const NEWS_RE = /^(new|list|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

export function parseEditorDeepLink(search: string): EditorDeepLink {
  const params = new URLSearchParams(search);
  const open = params.get('open') === 'settings' ? 'settings' : null;
  const raw = params.get('section');
  const news = params.get('news');
  return { open, section: raw && SECTION_RE.test(raw) ? raw : null, news: news && NEWS_RE.test(news) ? news : null };
}

export function hasDeepLink(link: EditorDeepLink): boolean {
  return link.open !== null || link.section !== null || link.news !== null;
}
