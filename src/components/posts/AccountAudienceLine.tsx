'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { COPY } from '@/lib/copy';
import { PRIVACY_SETTINGS_HREF, isPrivateAccount, whoSeesPost } from '@/lib/posts/audience';

interface AccountAudienceLineProps {
  /** The POSTING account's visibility (a guardian acting for an athlete
   *  passes the athlete's); defaults to the signed-in profile's. */
  accountVisibility?: string | null;
  /** An existing post written followers-only before Oct 9 2026. */
  legacyFansOnly?: boolean;
  /** Hide the Change link (e.g. a guardian, whose link would open THEIR settings). */
  hideChange?: boolean;
  className?: string;
}

/**
 * The one-line "who sees it" — where there is no Only me choice (the composer,
 * Edit post, a draft's review, an activity's later share). The account
 * decides; this says so, with a way to change it. See src/lib/posts/audience.ts.
 */
export default function AccountAudienceLine({ accountVisibility, legacyFansOnly, hideChange, className = '' }: AccountAudienceLineProps) {
  const { profile } = useAuth();
  const visibility = accountVisibility !== undefined ? accountVisibility : profile?.visibility;
  const privateAccount = isPrivateAccount(visibility);
  const line = legacyFansOnly ? COPY.AUDIENCE.LEGACY_FANS_ONLY : whoSeesPost(visibility);
  const icon = legacyFansOnly ? 'fa-lock' : privateAccount ? 'fa-user-group' : 'fa-globe';
  return (
    <p className={`flex items-start gap-2 text-sm text-secondary ${className}`} data-account-audience={legacyFansOnly ? 'fans-only' : privateAccount ? 'private' : 'public'}>
      <i className={`fas ${icon} mt-0.5 w-4 text-center text-tertiary`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        {line}
        {!hideChange && !legacyFansOnly && (
          <>
            {' '}
            <Link href={PRIVACY_SETTINGS_HREF} className="relative after:absolute after:content-[''] after:-inset-y-3 after:-inset-x-1 font-semibold text-brand-fg hover:underline">
              {COPY.AUDIENCE.CHANGE}
            </Link>
          </>
        )}
      </span>
    </p>
  );
}
