import Link from 'next/link';
import type { PublicDocument } from '@/lib/org-sites/validate';
import { orgMediaUrl } from '@/lib/media/org-site-media';

// Documents & policies module (phase 6b B3): stored PDFs (streamed by
// the tokenless org-media route, inline) and external https links.
// Props-only, server-safe; every href is either a same-origin streamer
// URL built from a validated path or an https URL the schema accepted.
export default function DocumentsList({
  documents,
  siteId,
  basePath,
  detailed,
}: {
  documents: PublicDocument[];
  siteId: string;
  basePath: string;
  detailed: boolean;
}) {
  const shown = detailed ? documents : documents.slice(0, 5);
  return (
    <>
      <ul className="mt-2 divide-y divide-border-subtle">
        {shown.map((doc, i) => {
          const href = doc.path ? orgMediaUrl(siteId, doc.path) : doc.url;
          if (!href) return null;
          return (
            <li key={`${doc.title}-${i}`} className="py-2.5 flex items-baseline justify-between gap-3">
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-brand-fg"
              >
                {doc.title}
              </a>
              <span className="text-xs text-tertiary shrink-0">{doc.path ? 'PDF' : 'Link'}</span>
            </li>
          );
        })}
      </ul>
      {!detailed && documents.length > shown.length ? (
        <Link href={`${basePath}/documents`} className="mt-3 inline-block text-sm text-brand-fg font-medium">
          All documents →
        </Link>
      ) : null}
    </>
  );
}
