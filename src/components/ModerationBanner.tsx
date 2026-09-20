'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { effectiveState } from '@/lib/moderation/state';

// Support & Reporting, Spec 2 (migration 223): a limited / suspended /
// banned account sees why on every screen, with the door to the notice
// under Settings → Support (the restricted appeal view). Mounted once in
// the root layout beside DeletionScheduledBanner. Reads the profile the
// auth provider already holds (select('*') carries the new columns; pre-223
// they are absent and the state reads as active — nothing renders).
export default function ModerationBanner() {
  const { user, profile } = useAuth();
  if (!user || !profile) return null;
  const state = effectiveState(profile);
  if (state === 'active') return null;

  const until = profile.moderation_until
    ? new Date(profile.moderation_until).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
    : null;
  const words =
    state === 'limited'
      ? 'Your account is read-only while we review a report — you can read, but not post, comment or message.'
      : state === 'suspended'
        ? `Your account is suspended${until ? ` until ${until}` : ''}.`
        : 'This account has been banned.';
  const href = profile.moderation_ticket_id ? `/settings?tab=support&ticket=${profile.moderation_ticket_id}` : '/settings?tab=support';

  return (
    <div className="bg-amber-600 text-white px-4 py-2 text-sm flex flex-wrap items-center justify-center gap-x-3 gap-y-1" role="alert" data-moderation-banner={state}>
      <span>
        <i className="fas fa-gavel mr-2" aria-hidden="true"></i>
        {words}
      </span>
      <Link href={href} className="inline-flex min-h-[44px] items-center -my-2 font-bold underline underline-offset-2 hover:text-amber-100">
        See why
      </Link>
    </div>
  );
}
