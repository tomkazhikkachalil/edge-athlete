// The documents list as the editor edits it (sports-team website program,
// H1, Sep 27 2026) — moved into the editor from the console: title + a
// stored PDF OR an https link, saved WHOLE through `set_documents` by the
// panel's "Save content" (the sponsors' recipe). Pure, zero imports.

export interface DocumentDraft {
  title: string;
  /** org-media/{siteId}/… — a PDF uploaded through the site's asset route. */
  path: string;
  url: string;
}

export const DOCUMENTS_MAX = 20;

export function readDocumentDrafts(config: Record<string, unknown>): DocumentDraft[] {
  const raw = config.documents;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((d): d is Record<string, unknown> => !!d && typeof d === 'object')
    .slice(0, DOCUMENTS_MAX)
    .map(d => ({
      title: typeof d.title === 'string' ? d.title : '',
      path: typeof d.path === 'string' ? d.path : '',
      url: typeof d.path === 'string' && d.path ? '' : typeof d.url === 'string' ? d.url : '',
    }));
}

/** set_documents' payload: a row needs a title AND a file or a link; a file wins over a link. */
export function documentsPayload(drafts: readonly DocumentDraft[]): { title: string; path?: string; url?: string }[] {
  return drafts
    .filter(d => d.title.trim() && (d.path || d.url.trim()))
    .map(d => ({ title: d.title.trim(), ...(d.path ? { path: d.path } : { url: d.url.trim() }) }));
}
