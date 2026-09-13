import type { PublicOpenWindow } from '@/lib/org-sites/public-data';
import { appBaseUrl } from '@/lib/org-sites/urls';

// Phase 5 R5: the public registration door — the open windows and ONE
// button into the app's registration flow (the site never registers
// anyone itself). Program 3, D1: `variant` — the windows and the button
// (today), or the button alone.

const windowDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

export default function RegisterCard({
  windows,
  side,
  orgId,
  variant = 'list',
}: {
  windows: PublicOpenWindow[];
  side: 'league' | 'club';
  orgId: string;
  variant?: 'list' | 'button';
}) {
  return (
    <div className="mt-2" data-variant={variant}>
      {variant === 'list' && (
        <ul className="space-y-1.5">
          {windows.map((w, i) => (
            <li key={i} className="text-sm text-secondary">
              <span className="font-medium text-primary">{w.seasonLabel}</span>
              {w.offeringName ? ` · ${w.offeringName}` : ''}
              {w.closesAt ? ` — open until ${windowDate(w.closesAt)}` : ' — open now'}
            </li>
          ))}
        </ul>
      )}
      <a
        href={`${appBaseUrl()}/register/${side}/${orgId}`}
        className={`${variant === 'list' ? 'mt-3' : ''} inline-flex px-4 py-2 text-sm min-h-[40px] items-center rounded-lg text-white font-medium`}
        style={{ backgroundColor: 'var(--org-accent)' }}
      >
        Register
      </a>
    </div>
  );
}
