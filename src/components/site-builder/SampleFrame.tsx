// A placeholder the canvas draws for a SAMPLED embed — Site Builder
// program 3, S2 (Sep 13 2026). Sample data never loads a third-party
// iframe (no fake YouTube id, no external request from the editor), so an
// empty embed tile shows a 16:9 frame with a play glyph instead. Props-only,
// editor-only: the public renderer never sees a sampled instance.
export default function SampleFrame({ kind = 'video' }: { kind?: 'video' }) {
  return (
    <div
      className="flex aspect-video w-full items-center justify-center rounded-lg bg-gradient-to-br from-slate-500 to-slate-800 text-white"
      data-sb-sample-frame={kind}
      role="img"
      aria-label="Sample video placeholder"
    >
      <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/25">
        <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M8 5v14l11-7z" fill="currentColor" />
        </svg>
      </span>
    </div>
  );
}
