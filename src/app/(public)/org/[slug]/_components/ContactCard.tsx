import type { ReactNode } from 'react';
import {
  directionsHref,
  SOCIAL_LABELS,
  SOCIAL_NETWORKS,
  type PublicContact,
} from '@/lib/org-sites/validate';
import { contactRenderOrder, type ContactFieldKey } from '@/lib/site-builder/display';

// The contact card (phase 3 R3; the golf club's fields in 6e S1). Program
// 3, D1b: `variant` — stacked (today), one line of links (`inline`), or
// two columns (`split`); `showSocials`. Program 3, H3: the fields render
// in the manager's ORDER (`contact_config.order`, `contactRenderOrder`
// fills the rest in today's order — an untouched card is byte-identical).
export default function ContactCard({ contact, variant = 'card', showSocials = true }: { contact: PublicContact; variant?: 'card' | 'inline' | 'split'; showSocials?: boolean }) {
  const directions = directionsHref(contact);
  const socials = showSocials ? SOCIAL_NETWORKS.filter(n => contact.social?.[n]) : [];
  const inline = variant === 'inline';
  const split = variant === 'split';
  const link = (href: string, label: ReactNode, external = true) => (
    <a href={href} {...(external ? { target: '_blank', rel: 'noopener nofollow' } : {})} className="font-medium text-brand-fg">
      {label}
      {external && <span className="sr-only"> (opens in a new tab)</span>}
    </a>
  );
  const blocks: Partial<Record<ContactFieldKey, ReactNode>> = {
    address:
      contact.address && contact.address.length > 0 ? (
        <address className="not-italic text-sm text-secondary">
          {contact.address.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </address>
      ) : undefined,
    hours: contact.hours ? (
      <p className="text-sm text-secondary whitespace-pre-line">
        <span className="font-medium text-primary">Hours</span>
        {'\n'}
        {contact.hours}
      </p>
    ) : undefined,
    directions: directions ? <p className="text-sm text-secondary">{link(directions, 'Directions →')}</p> : undefined,
    email: contact.email ? (
      <p className="text-sm text-secondary">
        Email: {link(`mailto:${contact.email}`, contact.email, false)}
      </p>
    ) : undefined,
    phone: contact.phone ? (
      <p className="text-sm text-secondary">
        Phone: {link(`tel:${contact.phone.replace(/[^\d+]/g, '')}`, contact.phone, false)}
      </p>
    ) : undefined,
    website: contact.website ? (
      <p className="text-sm text-secondary">
        Website: {link(contact.website, contact.website.replace(/^https:\/\//, ''))}
      </p>
    ) : undefined,
    social:
      socials.length > 0 ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Social links">
          {socials.map(n => (
            <li key={n} className="text-sm">
              {link(contact.social![n]!, SOCIAL_LABELS[n])}
            </li>
          ))}
        </ul>
      ) : undefined,
  };
  const order = contactRenderOrder(contact.order).filter(k => blocks[k] !== undefined);
  const item = (k: ContactFieldKey) => (
    <div key={k} data-contact-field={k}>
      {blocks[k]}
    </div>
  );
  if (split) {
    // Two columns: the place (address, hours, directions) left, the links right — each in the manager's order.
    const placeKeys: ContactFieldKey[] = ['address', 'hours', 'directions'];
    const place = order.filter(k => placeKeys.includes(k));
    const links = order.filter(k => !placeKeys.includes(k));
    return (
      <div className="mt-2 grid gap-4 sm:grid-cols-2" data-variant={variant}>
        <div className="space-y-3">{place.map(item)}</div>
        <div className="space-y-3">{links.map(item)}</div>
      </div>
    );
  }
  return (
    <div className={`mt-2 ${inline ? 'flex flex-wrap items-baseline gap-x-6 gap-y-2' : 'space-y-3'}`} data-variant={variant}>
      {order.map(item)}
    </div>
  );
}
