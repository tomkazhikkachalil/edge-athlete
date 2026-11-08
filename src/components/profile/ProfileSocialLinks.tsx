'use client';

import { formatDisplayName, formatSocialHandle, formatSocialHandleDisplay } from '@/lib/formatters';
import FaIcon from '@/components/FaIcon';
import { faTiktokBrands } from '@/lib/icons/fa/tiktok-brands';
import { faXTwitterBrands } from '@/lib/icons/fa/x-twitter-brands';
import type { FaIconDef } from '@/lib/icons/fa-icon';
import { faFacebookBrands } from '@/lib/icons/fa/facebook-brands';
import { faInstagramBrands } from '@/lib/icons/fa/instagram-brands';

/**
 * The profile's social links as OUTBOUND links — the one rendering, shared by
 * the owner's `/athlete` and a visitor's `/athlete/[id]` (Convention 52: the
 * owner's read-only view is the visitor's view; the handles are EDITED in
 * Edit Profile → Socials, never inline on the profile). Renders nothing when
 * no handle is set.
 */
export interface SocialLinksProfile {
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  social_twitter?: string | null;
  social_instagram?: string | null;
  social_tiktok?: string | null;
  social_facebook?: string | null;
}

type NetworkKey = 'social_twitter' | 'social_instagram' | 'social_tiktok' | 'social_facebook';

const NETWORKS: ReadonlyArray<{ key: NetworkKey; label: string; href: (handle: string) => string; icon: FaIconDef; tone?: string }> = [
  { key: 'social_twitter', label: 'X', href: h => `https://x.com/${h}`, icon: faXTwitterBrands },
  { key: 'social_instagram', label: 'Instagram', href: h => `https://instagram.com/${h}`, icon: faInstagramBrands, tone: 'text-pink-600' },
  { key: 'social_tiktok', label: 'TikTok', href: h => `https://www.tiktok.com/@${h}`, icon: faTiktokBrands },
  { key: 'social_facebook', label: 'Facebook', href: h => `https://facebook.com/${h}`, icon: faFacebookBrands, tone: 'text-brand-fg' },
];

export function hasSocialLinks(profile: SocialLinksProfile | null | undefined): boolean {
  return !!profile && NETWORKS.some(n => !!profile[n.key]);
}

interface ProfileSocialLinksProps {
  profile: SocialLinksProfile | null | undefined;
  /** When given, the links sit in their own row (a `role="list"`); without it they are siblings of the caller's row. */
  rowClassName?: string;
}

export default function ProfileSocialLinks({ profile, rowClassName }: ProfileSocialLinksProps) {
  if (!hasSocialLinks(profile) || !profile) return null;
  const name = formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name);
  const links = NETWORKS.map(n => {
    const value = profile[n.key];
    if (!value) return null;
    return (
      <a
        key={n.key}
        href={n.href(formatSocialHandle(value))}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${name} on ${n.label}`}
        className="flex items-center gap-2 text-primary font-bold hover:text-brand-fg transition-colors"
        {...(rowClassName ? { role: 'listitem' } : {})}
      >
        <FaIcon icon={n.icon} className={`text-2xl${n.tone ? ` ${n.tone}` : ''}`} />
        <span>{formatSocialHandleDisplay(value)}</span>
      </a>
    );
  });
  if (!rowClassName) return <>{links}</>;
  return (
    <div className={rowClassName} role="list" aria-label="Social media links">
      {links}
    </div>
  );
}
