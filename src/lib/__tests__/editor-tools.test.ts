import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// The photo editor's tools (Nov 6 2026, Tom: "the first few selections make
// sense and towards the end it gets complicated"). Six image tools, simple →
// advanced, every one on screen at 375 px as an icon over a label; Perspective
// (Vertical / Horizontal) is no longer a tab — it lives in Crop's geometry row
// beside Straighten, the way iOS Photos keeps its keystone dials. Nothing was
// removed: the warp is the same recipe field, undoable under the same label.

const DIR = join(__dirname, '..', '..', 'components', 'media-editor');
const read = (file: string) => readFileSync(join(DIR, file), 'utf8');

describe('the editor offers six image tools, simple to advanced', () => {
  const modal = read('MediaEditorModal.tsx');
  it('lists them in order, each with an icon, and no Perspective tab', () => {
    const block = modal.slice(modal.indexOf('const IMAGE_TOOLS'), modal.indexOf('const VIDEO_TOOLS'));
    const ids = [...block.matchAll(/id: '([a-z]+)'/g)].map(m => m[1]);
    expect(ids).toEqual(['crop', 'adjust', 'filter', 'text', 'retouch', 'masks']);
    expect(block.match(/, icon: (?!LucideIcon)[A-Z]/g)?.length).toBe(6);
    expect(modal).not.toContain('PerspectivePanel');
    expect(existsSync(join(DIR, 'PerspectivePanel.tsx'))).toBe(false);
  });
  it('draws the tabs as equal-width icon-over-label buttons that never scroll', () => {
    expect(modal).toContain('flex-1 min-w-0 min-h-[56px] flex flex-col items-center justify-center');
    expect(modal).not.toContain('[&>*:first-child]:ml-auto');
    expect(modal).toContain('aria-pressed={activeTool === t.id}');
  });
});

describe("Perspective lives in Crop's geometry row", () => {
  const modal = read('MediaEditorModal.tsx');
  it('both crop stages render the row with the chooser lifted to the modal', () => {
    for (const stage of ['FreeCropStage.tsx', 'CropStage.tsx']) {
      const source = read(stage);
      expect(source, stage).toContain('<GeometryRow');
      expect(source, stage).toContain('axis="straighten"');
      expect(source, stage).toContain('onAxisChange={onAxisChange}');
      expect(source, stage).not.toContain('aria-label="Straighten angle"'); // the row owns the slider
    }
  });
  it('the row keeps the straighten slider name the crop spec pins, and names the two warp axes', () => {
    const row = read('GeometryRow.tsx');
    expect(row).toContain("'Straighten angle'");
    expect(row).toContain("'Vertical' : 'Horizontal'");
    expect(row).toContain('aria-pressed={axis === a.id}');
  });
  it('a warp axis swaps the crop stage for the engine preview and lands under the same history label', () => {
    expect(modal).toContain("activeTool === 'crop' && geometryAxis === 'straighten' ? (");
    expect(modal).toContain('`perspective.${axis}`');
    expect(modal).toContain("patchRecipe(active.id, { perspective: undefined }, 'reset.perspective')");
    // Leaving Crop, or switching photos, returns the row to Straighten.
    expect(modal).toContain("setGeometryAxis('straighten');");
    expect(modal).not.toMatch(/onClick=\{\(\) => setTool\(/);
  });
  it("'perspective' in a surface's tools list is what offers the warp axes", () => {
    expect(modal).toContain("const offersPerspective = !config.tools || config.tools.includes('perspective');");
    expect(readFileSync(join(__dirname, '..', 'media', 'types.ts'), 'utf8')).toContain("'perspective'");
  });
});
