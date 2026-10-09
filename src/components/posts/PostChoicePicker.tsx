'use client';

import { useAuth } from '@/lib/auth';
import { COPY } from '@/lib/copy';
import { isPrivateAccount, onlyMeLine, whoSeesPost, type PostChoice } from '@/lib/posts/audience';

interface PostChoicePickerProps {
  value: PostChoice;
  onChange: (next: PostChoice) => void;
  /** Where an Only me item is kept, e.g. "in your Vitals". */
  onlyMePlace?: string;
  /** The POSTING account's visibility — pass it when acting for someone else
   *  (a guardian); defaults to the signed-in profile's. */
  accountVisibility?: string | null;
  disabled?: boolean;
}

/**
 * "Who sees it?" — the one per-item choice (Tom, Oct 9 2026): Post it (who
 * sees it follows the account) or Only me (not on the feed). Two big cards;
 * the whole card is the target. See src/lib/posts/audience.ts.
 */
export default function PostChoicePicker({ value, onChange, onlyMePlace, accountVisibility, disabled }: PostChoicePickerProps) {
  const { profile } = useAuth();
  const visibility = accountVisibility !== undefined ? accountVisibility : profile?.visibility;
  const privateAccount = isPrivateAccount(visibility);

  const options: Array<{ key: PostChoice; label: string; line: string; icon: string }> = [
    { key: 'post', label: COPY.AUDIENCE.POST_IT, line: whoSeesPost(visibility), icon: privateAccount ? 'fa-user-group' : 'fa-globe' },
    { key: 'only_me', label: COPY.AUDIENCE.ONLY_ME, line: onlyMeLine(onlyMePlace), icon: 'fa-lock' },
  ];

  return (
    <fieldset data-post-choice="" disabled={disabled}>
      <legend className="text-sm font-semibold text-primary mb-2">{COPY.AUDIENCE.QUESTION}</legend>
      <div role="radiogroup" aria-label={COPY.AUDIENCE.QUESTION} className="space-y-2">
        {options.map(o => {
          const selected = value === o.key;
          return (
            <button
              key={o.key}
              type="button"
              role="radio"
              aria-checked={selected}
              data-choice={o.key}
              onClick={() => onChange(o.key)}
              className={`w-full min-h-[56px] flex items-start gap-3 rounded-lg border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                selected
                  ? 'border-brand bg-brand-soft ring-1 ring-brand'
                  : 'border-border bg-surface hover:bg-surface-muted'
              }`}
            >
              <i className={`fas ${o.icon} mt-0.5 w-5 text-center ${selected ? 'text-brand-fg' : 'text-tertiary'}`} aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-primary">{o.label}</span>
                <span className="block text-sm text-secondary">{o.line}</span>
              </span>
              <span
                className={`mt-1 h-4 w-4 flex-shrink-0 rounded-full border-2 ${selected ? 'border-brand bg-brand' : 'border-border-strong'}`}
                aria-hidden="true"
              />
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
