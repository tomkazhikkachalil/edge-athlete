/**
 * Public entry for the media editor. Always import from here — the modal is
 * lazy-loaded (react-easy-crop + the render pipeline stay out of every
 * page's initial JS; house pattern, same as EmojiPickerButton).
 *
 * The `loading` shell (Sep 2026): between a capture and the chunk arriving
 * nothing used to render, so on a slow phone connection — or a tab Safari
 * had just reloaded under memory pressure — taking a photo looked like it
 * did nothing. Same frame as the modal root (fixed, z-[65], black) so the
 * hand-off is seamless; no dialog role, the real modal owns "Edit media".
 */

import dynamic from 'next/dynamic';

function EditorLoading() {
  return (
    <div
      aria-live="polite"
      className="fixed inset-0 z-[65] bg-black flex flex-col items-center justify-center gap-3 safe-top safe-bottom"
    >
      <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
      <p className="text-label text-white/80">Opening editor…</p>
    </div>
  );
}

/** Fetch + evaluate the editor's chunk ahead of the pick (Oct 15 2026,
 *  photo → editor speed): call it where a photo is about to be chosen — a
 *  composer opening, a camera button, a profile-photo door — so the editor
 *  opens without the "Opening editor…" shell. Fire-and-forget; idempotent
 *  (the module cache answers every call after the first). */
export function warmEditorChunk(): void {
  void import('./MediaEditorModal').catch(() => undefined);
}

export const MediaEditor = dynamic(() => import('./MediaEditorModal'), {
  ssr: false,
  loading: EditorLoading,
});
export type { MediaEditorModalProps } from './MediaEditorModal';
