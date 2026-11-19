import { describe, it, expect } from 'vitest';
import { pdfTextLines } from '../site-text-server';

// Nov 18 2026: text out of a PDF with pdf.js, for the rule-based scorecard
// reader. The PDF here is built by hand: one page, two lines of text.

function tinyPdf(lines: Array<{ y: number; cells: Array<{ x: number; text: string }> }>): Uint8Array {
  const stream = ['BT', '/F1 10 Tf', ...lines.flatMap(l => l.cells.map(c => `1 0 0 1 ${c.x} ${l.y} Tm (${c.text}) Tj`)), 'ET'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(body);
}

describe('pdfTextLines', () => {
  it('gives the text as lines, top to bottom and left to right, whatever order the file wrote it in', async () => {
    const pdf = tinyPdf([
      { y: 600, cells: [{ x: 200, text: '3320' }, { x: 40, text: 'Blue' }, { x: 100, text: '380' }] },
      { y: 700, cells: [{ x: 40, text: 'Par' }, { x: 100, text: '4' }, { x: 130, text: '5' }] },
    ]);
    expect(await pdfTextLines(pdf)).toEqual([['Par', '4', '5'], ['Blue', '380', '3320']]);
  });
  it('items a point or two apart vertically are one line', async () => {
    const pdf = tinyPdf([{ y: 500, cells: [{ x: 40, text: 'Par' }] }, { y: 501.5, cells: [{ x: 100, text: '4' }] }, { y: 480, cells: [{ x: 40, text: 'next' }] }]);
    expect(await pdfTextLines(pdf)).toEqual([['Par', '4'], ['next']]);
  });
  it('a file that is not a PDF, an empty one and a cut-off one are no text, never a throw', async () => {
    expect(await pdfTextLines(new TextEncoder().encode('<html>not a pdf</html>'))).toEqual([]);
    expect(await pdfTextLines(new Uint8Array(0))).toEqual([]);
    const whole = tinyPdf([{ y: 700, cells: [{ x: 40, text: 'Par' }] }]);
    expect(Array.isArray(await pdfTextLines(whole.slice(0, 120)))).toBe(true);
  });
  it('does not change the bytes it was given', async () => {
    const pdf = tinyPdf([{ y: 700, cells: [{ x: 40, text: 'Par' }] }]);
    const before = pdf.length;
    await pdfTextLines(pdf);
    expect(pdf.length).toBe(before);
  });
});
