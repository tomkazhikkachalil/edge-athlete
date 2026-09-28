// Inline formatting in a paragraph (sports-team website program, N1,
// Sep 27 2026): **bold** and [a link](https://…) — the two things a club
// writing news actually needs. PARSED into typed pieces, never HTML: the
// renderer (InlineText) builds elements from them, so no markup a manager
// types can reach the page. A link must be https (anything else — a
// javascript: or a mailto: — stays literal text); an unclosed ** stays
// literal. Pure, zero imports.

export type InlineNode =
  | { t: 'text'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'link'; label: string; href: string };

const TOKEN_RE = /\*\*([^*\n][^*]*?)\*\*|\[([^\]\n]{1,200})\]\((https:\/\/[^\s)]{1,500})\)/g;

function safeHttps(raw: string): string | null {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && !!url.hostname ? raw : null;
  } catch {
    return null;
  }
}

export function parseInline(text: string): InlineNode[] {
  const out: InlineNode[] = [];
  let last = 0;
  const push = (v: string) => {
    if (!v) return;
    const prev = out[out.length - 1];
    if (prev && prev.t === 'text') prev.v += v;
    else out.push({ t: 'text', v });
  };
  for (const m of text.matchAll(TOKEN_RE)) {
    const at = m.index ?? 0;
    push(text.slice(last, at));
    if (m[1] !== undefined) {
      out.push({ t: 'bold', v: m[1] });
    } else {
      const href = safeHttps(m[3]!);
      if (href) out.push({ t: 'link', label: m[2]!, href });
      else push(m[0]);
    }
    last = at + m[0].length;
  }
  push(text.slice(last));
  return out;
}

/** The words only — for excerpts, bells, meta descriptions and the digest. */
export function inlineToPlain(text: string): string {
  return parseInline(text)
    .map(n => (n.t === 'link' ? n.label : n.v))
    .join('');
}
