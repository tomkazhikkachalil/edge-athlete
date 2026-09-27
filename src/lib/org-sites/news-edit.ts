// The block editor's go-live PATCH (sports-team website program, P0-1,
// Sep 27 2026). Publish / Unpublish used to send `{publish}` alone and then
// refetch the row — the refetch replaced the form with the server copy, so
// a title or body typed but not yet saved was silently lost. The toggle now
// carries the unsaved edits in the SAME PATCH (both schemas accept them
// together), and the editor adopts the response instead of refetching.
// Pure, zero imports.

export type EditorMode = 'page' | 'news';

export interface EditorEdits<B> {
  /** The form differs from the last saved snapshot. */
  dirty: boolean;
  title: string;
  blocks: B[];
}

export type VisibilityPatch<B> =
  | { visibility: 'public' | 'draft'; title?: string; body?: B[] }
  | { publish: boolean; title?: string; body?: B[] };

/** The one PATCH for a go-live toggle: the state change, plus the unsaved
 *  title + body when the form is dirty (never when it is clean — a clean
 *  toggle must not rewrite content). */
export function visibilityPatch<B>(
  mode: EditorMode,
  next: 'public' | 'draft',
  edits: EditorEdits<B>
): VisibilityPatch<B> {
  const content = edits.dirty ? { title: edits.title.trim(), body: edits.blocks } : {};
  return mode === 'page'
    ? { visibility: next, ...content }
    : { publish: next === 'public', ...content };
}

/** The snapshot the editor compares against after the PATCH succeeds:
 *  what was just written (dirty) or the unchanged saved one (clean). */
export function snapshotAfter<B>(edits: EditorEdits<B>, savedSnapshot: string): string {
  return edits.dirty ? JSON.stringify({ title: edits.title.trim(), blocks: edits.blocks }) : savedSnapshot;
}
