/**
 * The article body renderer (Spec 3) — pure.
 *
 * Bodies are PLAIN TEXT (the table comment says so): blank lines separate
 * paragraphs, lines starting with "- " are bullets, a line starting with
 * "## " is a heading, and a bare URL becomes a link. Never HTML — the
 * component renders these blocks; nothing is dangerouslySetInnerHTML'd.
 */
export type HelpBlock =
  | { kind: 'heading'; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'bullets'; items: string[] };

export function parseHelpBody(body: string): HelpBlock[] {
  const blocks: HelpBlock[] = [];
  const chunks = body.replace(/\r\n/g, '\n').split(/\n{2,}/);
  for (const raw of chunks) {
    const chunk = raw.trim();
    if (!chunk) continue;
    const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 1 && lines[0].startsWith('## ')) {
      blocks.push({ kind: 'heading', text: lines[0].slice(3).trim() });
      continue;
    }
    if (lines.every(l => l.startsWith('- '))) {
      blocks.push({ kind: 'bullets', items: lines.map(l => l.slice(2).trim()) });
      continue;
    }
    blocks.push({ kind: 'paragraph', text: lines.join(' ') });
  }
  return blocks;
}

/** The first paragraph, trimmed to a card's worth. */
export function excerptOf(body: string, max = 160): string {
  const first = parseHelpBody(body).find(b => b.kind === 'paragraph');
  const text = first && first.kind === 'paragraph' ? first.text : '';
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Split a paragraph into text and bare-URL segments (http/https only). */
export function linkify(text: string): Array<{ kind: 'text'; text: string } | { kind: 'link'; href: string }> {
  const out: Array<{ kind: 'text'; text: string } | { kind: 'link'; href: string }> = [];
  const re = /https?:\/\/[^\s<>"']+/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const start = m.index ?? 0;
    if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
    out.push({ kind: 'link', href: m[0].replace(/[.,;:!?)]+$/, '') });
    last = start + m[0].length - (m[0].length - m[0].replace(/[.,;:!?)]+$/, '').length);
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
