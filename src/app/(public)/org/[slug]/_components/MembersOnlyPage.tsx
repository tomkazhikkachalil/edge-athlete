import type { PublicSite } from '@/lib/org-sites/server';
import MembersOnlyPanel from './MembersOnlyPanel';

/** A whole members-only subpage on a private club's site (V4): the
 *  heading the nav promised, then the panel. */
export default function MembersOnlyPage({ site, title, what }: { site: PublicSite; title: string; what: string }) {
  return (
    <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-primary">{title}</h1>
      <MembersOnlyPanel site={site} what={what} />
    </div>
  );
}
