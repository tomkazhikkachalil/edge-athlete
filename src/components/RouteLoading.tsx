/**
 * The ONE route-level loading view (launch phase 3, PR I, Nov 4 2026) — the
 * centred spinner the heavy signed-in pages already showed while they
 * fetched, lifted into a component so each segment's `loading.tsx` (shown by
 * Next while the route's chunk and payload stream in) and the page's own
 * fetching branch render the SAME thing: one hand-off, no second visual
 * language, no layout shift between the two. Pure presentation — no hooks,
 * no client boundary — so a server `loading.tsx` can render it.
 */

export interface RouteLoadingProps {
  /** The line under the spinner — what is being loaded, in the page's words. */
  message: string;
  /** A second, quieter line (the feed's "Getting everything ready"). */
  detail?: string;
  /** Spinner size: the feed's is larger than a profile's. */
  size?: 'md' | 'lg';
  /** `screen` centres in the viewport (a page with no header yet); `block` leaves the room a header takes. */
  fill?: 'screen' | 'block';
}

export default function RouteLoading({ message, detail, size = 'md', fill = 'screen' }: RouteLoadingProps) {
  const ring = size === 'lg' ? 'h-12 w-12' : 'h-8 w-8';
  return (
    <div
      className={fill === 'screen' ? 'min-h-screen bg-canvas flex items-center justify-center' : 'flex items-center justify-center py-20'}
      role="status"
      aria-live="polite"
      data-route-loading=""
    >
      <div className="text-center">
        <div className={`animate-spin rounded-full ${ring} border-b-2 border-brand mx-auto`} aria-hidden="true"></div>
        <p className={size === 'lg' ? 'mt-4 text-secondary font-medium' : 'mt-2 text-tertiary'}>{message}</p>
        {detail && <p className="mt-1 text-sm text-muted">{detail}</p>}
      </div>
    </div>
  );
}
