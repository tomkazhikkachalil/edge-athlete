'use client';

import { useAuth } from '@/lib/auth';
import { COPY } from '@/lib/copy';
import { feedOffLine, isPrivateAccount, whoSeesPost } from '@/lib/posts/audience';
import { rememberFeedChoice, type FeedKind } from '@/lib/posts/feed-memory';

interface FeedToggleProps {
  on: boolean;
  onChange: (next: boolean) => void;
  /** Remember the choice for this kind on the device (feed-memory.ts); omit for an edit (no memory). */
  kind?: FeedKind;
  /** Where the item stands when OFF, e.g. "in Training" / "in Stats". */
  place?: string;
  /** The POSTING account's visibility — pass it when acting for someone else
   *  (a guardian); defaults to the signed-in profile's. */
  accountVisibility?: string | null;
  disabled?: boolean;
  className?: string;
}

/**
 * "Post to feed" — the ONE per-item choice (Tom, Oct 19 2026; 269). A switch,
 * not an audience: ON says who will see it (the account's privacy), OFF says
 * it stays on the profile. The whole row is the target (≥ 56 px).
 * See src/lib/posts/audience.ts.
 */
export default function FeedToggle({ on, onChange, kind, place, accountVisibility, disabled, className = '' }: FeedToggleProps) {
  const { profile } = useAuth();
  const visibility = accountVisibility !== undefined ? accountVisibility : profile?.visibility;
  const privateAccount = isPrivateAccount(visibility);
  const line = on ? whoSeesPost(visibility) : feedOffLine(place);
  const icon = on ? (privateAccount ? 'fa-user-group' : 'fa-globe') : 'fa-eye-slash';
  const flip = () => {
    const next = !on;
    if (kind) rememberFeedChoice(kind, next);
    onChange(next);
  };
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={flip}
      data-feed-toggle={on ? 'on' : 'off'}
      className={`w-full min-h-[56px] flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-muted disabled:opacity-60 ${className}`}
    >
      <i className={`fas ${icon} w-5 text-center ${on ? 'text-brand-fg' : 'text-tertiary'}`} aria-hidden="true" />
      <span className="flex-1 min-w-0">
        <span className="block font-semibold text-primary">{COPY.AUDIENCE.FEED_TOGGLE}</span>
        <span className="block text-sm text-secondary" data-feed-toggle-line="">{line}</span>
      </span>
      <span
        className={`relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors ${on ? 'bg-brand' : 'bg-gray-300 dark:bg-stone-700'}`}
        aria-hidden="true"
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`} />
      </span>
    </button>
  );
}
