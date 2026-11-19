// ── Text out of a PDF, for the scorecard reader (Nov 18 2026) ───────────────
// pdfjs-dist, text only: no canvas, no rendering, no fonts fetched, no eval.
// A PDF from a course's website is somebody else's file: a few pages, a time
// limit, and any failure is simply "no text" (a scanned card has none, and a
// picture is not read: Tom ruled out AI in the app).

export const PDF_MAX_PAGES = 4;
export const PDF_TEXT_TIMEOUT_MS = 8_000;
/** Items within this many PDF units of each other vertically are one line. */
const LINE_TOLERANCE = 3;

interface TextItem { str?: string; transform?: number[] }

/** The PDF's text as lines of items, top to bottom, left to right. Empty when
 *  it has none, cannot be read, or takes too long. Never throws. */
export async function pdfTextLines(bytes: Uint8Array): Promise<string[][]> {
  let task: { promise: Promise<unknown>; destroy: () => Promise<void> } | null = null;
  const read = async (): Promise<string[][]> => {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // A copy: pdf.js takes ownership of the buffer it is given.
    task = getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0 }) as unknown as typeof task;
    const doc = (await task!.promise) as { numPages: number; getPage: (n: number) => Promise<{ getTextContent: () => Promise<{ items: TextItem[] }> }> };
    const lines: string[][] = [];
    for (let n = 1; n <= Math.min(doc.numPages, PDF_MAX_PAGES); n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      const items = content.items
        .filter(i => typeof i.str === 'string' && i.str.trim() && Array.isArray(i.transform))
        .map(i => ({ s: (i.str as string).trim(), x: (i.transform as number[])[4], y: (i.transform as number[])[5] }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      let row: typeof items = [];
      const flush = () => { if (row.length) lines.push(row.sort((a, b) => a.x - b.x).map(i => i.s)); row = []; };
      for (const item of items) {
        if (row.length && Math.abs(row[0].y - item.y) > LINE_TOLERANCE) flush();
        row.push(item);
      }
      flush();
    }
    return lines;
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<string[][]>(resolve => { timer = setTimeout(() => resolve([]), PDF_TEXT_TIMEOUT_MS); }),
    ]);
  } catch {
    return [];
  } finally {
    if (timer) clearTimeout(timer);
    await (task as { destroy: () => Promise<void> } | null)?.destroy().catch(() => undefined);
  }
}
