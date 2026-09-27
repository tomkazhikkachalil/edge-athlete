import type { SocialNetwork } from '@/lib/org-sites/validate';

// The four social networks a site can link (sports-team website program, L3,
// Sep 27 2026) as simple inline-SVG glyphs — the public tree loads no icon
// font (no Font Awesome under (public)). `currentColor`, so the caller's text
// colour paints them; the network's name rides an sr-only label.

export const SOCIAL_NAMES: Record<SocialNetwork, string> = {
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
  youtube: 'YouTube',
};

function Glyph({ network }: { network: SocialNetwork }) {
  switch (network) {
    case 'instagram':
      return (
        <>
          <rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="2" />
          <circle cx="17.5" cy="6.5" r="1.3" fill="currentColor" />
        </>
      );
    case 'facebook':
      return <path fill="currentColor" d="M13.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.5-1.5h1.6V4.4a21 21 0 0 0-2.3-.1c-2.3 0-3.9 1.4-3.9 4v2.2H7.8v3h2.6V21h3.1Z" />;
    case 'x':
      return <path fill="currentColor" d="M17.8 3h3.1l-6.8 7.7L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.3l4.4 5.8L17.8 3Zm-1.1 16.2h1.7L7.4 4.7H5.6l11.1 14.5Z" />;
    case 'youtube':
      return (
        <>
          <rect x="2" y="5" width="20" height="14" rx="4" fill="currentColor" />
          <path d="M10 9v6l5-3-5-3Z" fill="var(--color-surface, #fff)" />
        </>
      );
  }
}

/** `labelled` (default) adds the network's name for screen readers — pass
 *  false where the name is already visible text beside the icon. */
export default function SocialIcon({ network, size = 18, labelled = true }: { network: SocialNetwork; size?: number; labelled?: boolean }) {
  return (
    <>
      <svg aria-hidden="true" viewBox="0 0 24 24" width={size} height={size} className="shrink-0">
        <Glyph network={network} />
      </svg>
      {labelled && <span className="sr-only">{SOCIAL_NAMES[network]}</span>}
    </>
  );
}
