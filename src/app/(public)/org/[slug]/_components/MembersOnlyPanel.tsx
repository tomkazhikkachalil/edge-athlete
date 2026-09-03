import type { PublicSite } from '@/lib/org-sites/server';
import { appBaseUrl } from '@/lib/org-sites/urls';

// "Members only" (phase 9 V4) — what a private club's site shows in place
// of standings, teams, players, leaders and the gallery. Server-safe and
// props-only (the (public) segment): no session, no hooks. The doors are
// absolute app URLs so a custom domain can't swallow them.
export default function MembersOnlyPanel({ site, what }: { site: PublicSite; what?: string }) {
  const app = appBaseUrl();
  return (
    <div
      className="rounded-lg border border-border-subtle bg-surface-sunken p-4 sm:p-6 text-center"
      data-members-only="1"
    >
      <p className="text-sm font-semibold text-primary">Members only</p>
      <p className="mt-1 text-sm text-secondary">
        {`${what ?? 'This'} is visible to ${site.orgName} members. Join the club, or sign in if you're already a member.`}
      </p>
      <p className="mt-3 flex flex-wrap justify-center gap-3 text-sm">
        <a
          href={`${app}/join/club/${site.orgId}`}
          className="inline-block rounded-md bg-brand px-4 py-2 font-semibold text-white"
        >
          {`Join ${site.orgName}`}
        </a>
        <a href={`${app}/?next=${encodeURIComponent(`/club/${site.orgId}`)}`} className="inline-block px-4 py-2 font-medium text-brand-fg">
          Sign in →
        </a>
      </p>
    </div>
  );
}
