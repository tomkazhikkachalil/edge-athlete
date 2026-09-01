import type { PublicContact } from '@/lib/org-sites/validate';

// Contact module (cleanup round): manager-entered org contact info,
// DELIBERATELY public (the one place an email address ships on the
// public site by design). Values arrive re-validated via parseContact.
export default function ContactCard({ contact }: { contact: PublicContact }) {
  return (
    <ul className="mt-2 space-y-1.5">
      {contact.email && (
        <li className="text-sm text-secondary">
          Email:{' '}
          <a href={`mailto:${contact.email}`} className="font-medium text-brand-fg">
            {contact.email}
          </a>
        </li>
      )}
      {contact.phone && (
        <li className="text-sm text-secondary">
          Phone:{' '}
          <a href={`tel:${contact.phone.replace(/[^\d+]/g, '')}`} className="font-medium text-brand-fg">
            {contact.phone}
          </a>
        </li>
      )}
      {contact.website && (
        <li className="text-sm text-secondary">
          Website:{' '}
          <a
            href={contact.website}
            target="_blank"
            rel="noopener nofollow"
            className="font-medium text-brand-fg"
          >
            {contact.website.replace(/^https:\/\//, '')}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      )}
    </ul>
  );
}
