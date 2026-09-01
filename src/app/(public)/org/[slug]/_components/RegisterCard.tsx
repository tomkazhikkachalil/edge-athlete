import type { PublicOpenWindow } from '@/lib/org-sites/public-data';
import { appBaseUrl } from '@/lib/org-sites/urls';

// Register module (phase 5 R5): the OPEN windows + a static link into the
// app's wizard — the public segment is session-free, so this card never
// branches on a viewer and never submits anything. Absolute app URL on
// purpose: on an org subdomain a relative /register wouldn't resolve.

const windowDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RegisterCard({
  windows,
  side,
  orgId,
}: {
  windows: PublicOpenWindow[];
  side: 'league' | 'club';
  orgId: string;
}) {
  return (
    <div className="mt-2">
      <ul className="space-y-1.5">
        {windows.map((w, i) => (
          <li key={i} className="text-sm text-secondary">
            <span className="font-medium text-primary">{w.seasonLabel}</span>
            {w.offeringName ? ` · ${w.offeringName}` : ''}
            {w.closesAt ? ` — open until ${windowDate(w.closesAt)}` : ' — open now'}
          </li>
        ))}
      </ul>
      <a
        href={`${appBaseUrl()}/register/${side}/${orgId}`}
        className="mt-3 inline-flex px-4 py-2 text-sm min-h-[40px] items-center rounded-lg text-white font-medium"
        style={{ backgroundColor: 'var(--org-accent)' }}
      >
        Register
      </a>
    </div>
  );
}
