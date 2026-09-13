import Link from 'next/link';
import type { PublicDocument } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';

// Phase 6b B3: the documents module — stored PDFs (streamed by the
// org-media route) or external links. Program 3, D1: `variant` list
// (today) or grid; `count` (the home used to show five); `click` open in a
// new tab (today) or download (a stored PDF gets the download attribute).
export default function DocumentsList({
  documents,
  siteId,
  basePath,
  detailed,
  variant = 'list',
  count = 5,
  click = 'open',
}: {
  documents: PublicDocument[];
  siteId: string;
  basePath: string;
  detailed: boolean;
  variant?: 'list' | 'grid';
  count?: number;
  click?: 'open' | 'download';
}) {
  const shown = detailed ? documents : documents.slice(0, count);
  const link = (doc: PublicDocument, href: string) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      download={click === 'download' && doc.path ? true : undefined}
      className="text-sm font-medium text-brand-fg"
    >
      {doc.title}
    </a>
  );
  const items = shown
    .map((doc, i) => {
      const href = doc.path ? orgMediaUrl(siteId, doc.path) : doc.url;
      return href ? { doc, href, key: `${doc.title}-${i}` } : null;
    })
    .filter((x): x is { doc: PublicDocument; href: string; key: string } => x !== null);
  return (
    <>
      {variant === 'grid' ? (
        <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-variant="grid">
          {items.map(({ doc, href, key }) => (
            <li key={key} className="rounded-lg border border-border bg-canvas px-3 py-2.5">
              {link(doc, href)}
              <span className="block text-xs text-tertiary">{doc.path ? 'PDF' : 'Link'}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="mt-2 divide-y divide-border-subtle">
          {items.map(({ doc, href, key }) => (
            <li key={key} className="py-2.5 flex items-baseline justify-between gap-3">
              {link(doc, href)}
              <span className="text-xs text-tertiary shrink-0">{doc.path ? 'PDF' : 'Link'}</span>
            </li>
          ))}
        </ul>
      )}
      {!detailed && documents.length > shown.length ? (
        <Link href={`${basePath}/documents`} className="mt-3 inline-block text-sm text-brand-fg font-medium">
          All documents →
        </Link>
      ) : null}
    </>
  );
}
