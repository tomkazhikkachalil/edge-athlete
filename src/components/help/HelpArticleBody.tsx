import { linkify, parseHelpBody } from '@/lib/help/body';

/** Renders an article's plain-text body as blocks — never HTML (Spec 3). Server-safe. */
export default function HelpArticleBody({ body }: { body: string }) {
  const blocks = parseHelpBody(body);
  return (
    <div className="space-y-4 text-primary" data-help-body="">
      {blocks.map((b, i) => {
        if (b.kind === 'heading') return <h2 key={i} className="text-lg font-semibold text-primary mt-6">{b.text}</h2>;
        if (b.kind === 'bullets') {
          return (
            <ul key={i} className="list-disc pl-5 space-y-1 text-sm sm:text-base">
              {b.items.map((item, j) => <li key={j}>{renderInline(item)}</li>)}
            </ul>
          );
        }
        return <p key={i} className="text-sm sm:text-base leading-relaxed">{renderInline(b.text)}</p>;
      })}
    </div>
  );
}

function renderInline(text: string) {
  return linkify(text).map((seg, i) =>
    seg.kind === 'link' ? (
      <a key={i} href={seg.href} target="_blank" rel="noreferrer" className="text-brand-fg underline underline-offset-2 break-words">{seg.href}</a>
    ) : (
      <span key={i}>{seg.text}</span>
    )
  );
}
