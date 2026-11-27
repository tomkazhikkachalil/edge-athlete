'use client';

import { useId, useState, type Ref } from 'react';
import { captionTone, splitHashtagInput } from '@/lib/posts/composer-rules';
import { CloseIcon } from '@/components/golf/scoring/icons';
import { SparkIcon } from './icons';

/**
 * Caption and hashtags as ONE panel (Tom's General post spec, Nov 26 2026 —
 * C4): the caption with its counter, a divider, the hashtag row (chips, the
 * input, the suggestion key), and the suggestions under the panel while the
 * key is open. No visible hashtag count (R4): the limit holds silently — at
 * the limit the input and the suggestions stop adding.
 */
interface CaptionPanelProps {
  caption: string;
  onCaption: (next: string) => void;
  maxCaption: number;
  captionRef?: Ref<HTMLTextAreaElement>;
  /** Omit the hashtag half (a golf round's last step hosts the caption only). */
  hashtags?: {
    list: string[];
    max: number;
    onAdd: (tag: string) => void;
    onRemove: (tag: string) => void;
    /** What is typed and not yet a tag (the composer counts it as unsaved work). */
    typed: string;
    onTyped: (next: string) => void;
    suggestions: string[];
  };
}

const TONE_COLOUR = {
  empty: 'var(--mech-chevron)',
  ok: 'var(--mech-good-text)',
  warn: 'var(--mech-danger-text)',
  bad: 'var(--mech-bad-text)',
} as const;

export default function CaptionPanel({ caption, onCaption, maxCaption, captionRef, hashtags }: CaptionPanelProps) {
  const [suggesting, setSuggesting] = useState(false);
  const suggestId = useId();
  const tone = captionTone(caption.length, maxCaption);
  const full = hashtags ? hashtags.list.length >= hashtags.max : true;
  const open = hashtags ? hashtags.suggestions.filter(tag => !hashtags.list.includes(tag)) : [];

  return (
    <div className="min-w-0" data-compose-caption="">
      <div className="ea-mech-panel rounded-2xl">
        <div className="relative px-3.5 pb-6 pt-3">
          <label className="sr-only" htmlFor={`${suggestId}-caption`}>Caption</label>
          <textarea
            id={`${suggestId}-caption`}
            ref={captionRef}
            value={caption}
            onChange={e => onCaption(e.target.value.slice(0, maxCaption))}
            placeholder="Share your thoughts"
            rows={3}
            className="ea-mech-slot-input block w-full min-w-0 resize-none text-base leading-6 sm:text-[15px]"
          />
          <span
            className="ea-mech-readout absolute bottom-2 right-3.5 text-[10px] font-medium leading-none"
            style={{ color: TONE_COLOUR[tone] }}
            data-compose-count={tone}
            aria-label={`${caption.length} of ${maxCaption} characters`}
          >
            {caption.length}/{maxCaption}
          </span>
        </div>

        {hashtags && (
          <>
            <div aria-hidden="true" className="h-px" style={{ backgroundColor: 'var(--mech-hairline)' }} />
            <div className="flex min-w-0 items-start gap-2 px-3.5 py-2.5">
              <div className="flex min-h-[36px] min-w-0 flex-1 flex-wrap items-center gap-1.5" data-compose-hashtags="">
                {hashtags.list.map(tag => (
                  <span key={tag} className="inline-flex h-[30px] max-w-full items-center rounded-[15px] pl-3 text-[13px] font-medium" style={{ backgroundColor: 'var(--mech-selected-fill)', color: 'var(--mech-accent-light)' }}>
                    <span className="truncate">{tag}</span>
                    <button type="button" onClick={() => hashtags.onRemove(tag)} aria-label={`Remove ${tag}`} className="ea-mech-btn inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full">
                      <CloseIcon size={11} />
                    </button>
                  </span>
                ))}
                <input
                  type="text"
                  value={hashtags.typed}
                  onChange={e => {
                    const { tags, rest } = splitHashtagInput(e.target.value);
                    for (const tag of tags) hashtags.onAdd(tag);
                    hashtags.onTyped(rest);
                  }}
                  onKeyDown={e => {
                    if (e.key !== 'Enter') return;
                    e.preventDefault();
                    if (hashtags.typed.trim() === '') return;
                    hashtags.onAdd(hashtags.typed);
                    hashtags.onTyped('');
                  }}
                  onBlur={() => {
                    // A tag typed and left: it is added, never lost on the way to the slide.
                    if (hashtags.typed.trim() === '') return;
                    hashtags.onAdd(hashtags.typed);
                    hashtags.onTyped('');
                  }}
                  placeholder={hashtags.list.length === 0 ? 'Add hashtags' : ''}
                  aria-label="Add hashtags"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={full}
                  className="ea-mech-slot-input h-9 min-w-[5rem] flex-1 text-base sm:text-[14px]"
                  data-compose-hashtag-input=""
                />
              </div>
              <button
                type="button"
                onClick={() => setSuggesting(s => !s)}
                aria-expanded={suggesting}
                aria-controls={suggestId}
                aria-label="Hashtag suggestions"
                className="ea-mech-btn -my-1 -mr-1 inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px]"
                data-compose-suggest-key=""
              >
                {/* A 36 px key inside a 44 px target. */}
                <span aria-hidden="true" className="ea-mech-flatkey inline-flex h-9 w-9 items-center justify-center rounded-[10px]" style={suggesting ? { backgroundColor: 'var(--mech-accent)', color: '#ffffff' } : { color: 'var(--mech-gold-icon)' }}>
                  <SparkIcon size={16} />
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      {hashtags && suggesting && open.length > 0 && (
        <div id={suggestId} className="mt-2 flex flex-wrap gap-1.5" data-compose-suggestions="">
          {open.map(tag => (
            <button key={tag} type="button" onClick={() => hashtags.onAdd(tag)} disabled={full} className="ea-mech-suggest inline-flex h-8 max-w-full items-center rounded-2xl px-3 text-[13px] font-medium disabled:opacity-40">
              <span className="truncate">+ {tag}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
