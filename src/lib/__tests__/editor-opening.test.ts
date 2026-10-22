import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

// A photo opening in the editor shows that it is opening (Oct 22 2026, Tom:
// no preview proxy, keep the full-resolution decode — "but make sure a
// loading indicator shows while the photo opens"). Between the tap and the
// first visible frame the stage used to be black: the image is mounted at
// opacity 0 until its load, the engine canvas invisible until its first draw,
// and only a HEIC conversion said anything. Now every stage reports its first
// frame through onReady and the modal keeps the overlay up until then.

const DIR = join(__dirname, '..', '..', 'components', 'media-editor');
const modal = readFileSync(join(DIR, 'MediaEditorModal.tsx'), 'utf8');

describe('the editor says a photo is opening', () => {
  it('keeps a per-asset ready flag and an overlay over the stage until it is raised', () => {
    expect(modal).toContain('const [readyFor, setReadyFor] = useState<string | null>(null);');
    expect(modal).toContain("readyFor !== active.id && (");
    expect(modal).toContain('data-editor-opening=""');
    expect(modal).toContain('<StageOpening label="Opening photo…" />');
    expect(modal).toContain("<StageOpening label={preparing.has(active.id) ? 'Preparing photo…' : 'Opening photo…'} />");
    // The overlay sits over the stage column only (relative), never the header or the tools.
    expect(modal).toContain('<div className="relative flex-1 min-h-0 flex flex-col">');
    expect(modal).toContain('absolute inset-0 z-10 bg-black flex items-center justify-center');
  });
  it('every image stage raises it on its first visible frame', () => {
    for (const [file, hook] of [
      ['FreeCropStage.tsx', 'setNatural(size);\n              onReady?.();'],
      ['CropStage.tsx', 'setNaturalAspect(size.naturalWidth / size.naturalHeight);\n            onReady?.();'],
      ['EnginePreview.tsx', 'setReady(true);\n          onReadyRef.current?.();'],
      ['EnginePreview.tsx', 'onLoad={() => onReady?.()}'],
    ] as const) {
      expect(readFileSync(join(DIR, file), 'utf8'), file).toContain(hook);
    }
    for (const stage of ['CropStage', 'FreeCropStage', 'EnginePreview']) {
      expect(modal, stage).toMatch(new RegExp(`<${stage}[\\s\\S]*?onReady={\\(\\) => setReadyFor\\(active\\.id\\)}`));
    }
  });
  it('a video, a GIF or a converting HEIC never shows the photo overlay (they have their own states)', () => {
    expect(modal).toContain('activeUrl && !isVideo && !isGif && !preparing.has(active.id) && readyFor !== active.id');
  });
  it('the spinner is the house one, with a polite live region', () => {
    expect(modal).toContain('aria-live="polite" className="flex flex-col items-center gap-3"');
    expect(modal).toContain('w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin');
  });
});
