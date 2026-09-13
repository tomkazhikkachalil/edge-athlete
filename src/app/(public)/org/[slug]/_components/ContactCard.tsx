import {
  directionsHref,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  type PublicContact,
} from '@/lib/org-sites/validate';

// Contact module (cleanup round; S1 widened it into a golf club's contact
// card): manager-entered org contact info, DELIBERATELY public (the one
// place an email address ships on the public site by design). Values
// arrive re-validated via parseContact. Socials are TEXT links — the
// (public) segment has no icon font.
// Program 3, D1b: `variant` — stacked (today), one line of links
// (`inline`: the links as a row, address and hours beneath), or two
// columns (`split`: address + hours left, links right); `showSocials`.
export default function ContactCard({ contact, variant = 'card', showSocials = true }: { contact: PublicContact; variant?: 'card' | 'inline' | 'split'; showSocials?: boolean }) {
  const directions = directionsHref(contact);
  const socials = showSocials ? SOCIAL_NETWORKS.filter(n => contact.social?.[n]) : [];
  const inline = variant === 'inline';
  const split = variant === 'split';
  return (
    <div className={`mt-2 ${split ? 'grid gap-4 sm:grid-cols-2' : inline ? 'flex flex-col-reverse gap-3' : 'space-y-3'}`} data-variant={variant}>
      <div className={split ? 'space-y-3' : inline ? 'space-y-2 text-xs' : 'contents'}>
      {contact.address && contact.address.length > 0 && (
        <address className="not-italic text-sm text-secondary">
          {contact.address.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      )}
      {contact.hours && (
        <p className="text-sm text-secondary whitespace-pre-line">
          <span className="font-medium text-primary">Hours</span>
          {'\n'}
          {contact.hours}
        </p>
      )}
      </div>
      <div className={split ? 'space-y-3' : 'contents'}>
      <ul className={inline ? 'flex flex-wrap gap-x-4 gap-y-1' : 'space-y-1.5'}>
        {directions && (
          <li className="text-sm text-secondary">
            <a
              href={directions}
              target="_blank"
              rel="noopener nofollow"
              className="font-medium text-brand-fg"
            >
              Directions →<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </li>
        )}
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
      {socials.length > 0 && (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Social links">
          {socials.map(n => (
            <li key={n} className="text-sm">
              <a
                href={contact.social![n]}
                target="_blank"
                rel="noopener nofollow"
                className="font-medium text-brand-fg"
              >
                {SOCIAL_LABELS[n]}
                <span className="sr-only"> (opens in a new tab)</span>
              </a>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}
