import { parseInline } from '@/lib/org-sites/inline';

// A paragraph's inline formatting as elements (sports-team website program,
// N1, Sep 27 2026): **bold** → <strong>, [label](https://…) → <a>. Built from
// the typed pieces `parseInline` returns — never dangerouslySetInnerHTML, so
// nothing a manager types becomes markup. Server-safe (no hooks, no 'use
// client'): the public site and the app's news card both render it.

export default function InlineText({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((n, i) =>
        n.t === 'bold' ? (
          <strong key={i} className="font-semibold text-primary">
            {n.v}
          </strong>
        ) : n.t === 'link' ? (
          <a key={i} href={n.href} rel="nofollow ugc noopener" className="font-medium text-brand-fg underline">
            {n.label}
          </a>
        ) : (
          <span key={i}>{n.v}</span>
        )
      )}
    </>
  );
}
