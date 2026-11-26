// ── The General post composer's rules (Tom's spec, Nov 26 2026) ──────────────
// Pure, zero imports. The screen is one page: media, a caption with hashtags,
// a details panel, and a slide that posts. What may be posted, what the slide
// says, how a typed hashtag is split and how the tagged people read on their
// row are decided here; the components only draw the answers.

export interface PostReadiness {
  mediaCount: number;
  caption: string;
  /** One logged activity is attached (a post is valid with that alone). */
  hasActivity: boolean;
  /** A sport's stat line holds something (a stat-line sport's post). */
  hasStats?: boolean;
  /** A tile's bytes are still leaving the device. */
  uploading: boolean;
  /** A video over the clip limit waits for a trim. */
  tooLongVideo: boolean;
}

/** Nothing has been entered that a post could be made of. */
export function isEmptyPost(p: Pick<PostReadiness, 'mediaCount' | 'caption' | 'hasActivity' | 'hasStats'>): boolean {
  return p.mediaCount === 0 && p.caption.trim() === '' && !p.hasActivity && !p.hasStats;
}

/** X2: media, or a caption, or an attached activity — and no upload in progress. */
export function canPost(p: PostReadiness): boolean {
  if (isEmptyPost(p)) return false;
  return !p.uploading && !p.tooLongVideo;
}

export type SlideWords = 'Slide to post' | 'Uploading' | 'Posting' | 'Posted';

/** X1: the slide never names what is missing; it says what it is doing. */
export function slideWords(state: { uploading: boolean; posting: boolean; posted: boolean }): SlideWords {
  if (state.posted) return 'Posted';
  if (state.posting) return 'Posting';
  if (state.uploading) return 'Uploading';
  return 'Slide to post';
}

export type CaptionTone = 'empty' | 'ok' | 'warn' | 'bad';

/** The counter's colour: quiet when empty, good in range, a warning in the
 *  last 50 characters, bad at the limit. */
export function captionTone(length: number, max: number): CaptionTone {
  if (length <= 0) return 'empty';
  if (length >= max) return 'bad';
  if (length > max - 50) return 'warn';
  return 'ok';
}

/** A hashtag as it is stored: one leading "#", no spaces or commas. Empty
 *  when nothing is left. */
export function formatHashtag(raw: string): string {
  const word = raw.replace(/[\s,]+/g, '').replace(/^#+/, '');
  return word === '' ? '' : `#${word}`;
}

/** What typing did to the hashtag field: a space or a comma ends a tag. The
 *  finished tags come back formatted; `rest` stays in the field. */
export function splitHashtagInput(text: string): { tags: string[]; rest: string } {
  if (!/[\s,]/.test(text)) return { tags: [], rest: text };
  const parts = text.split(/[\s,]+/);
  const rest = parts.pop() ?? '';
  return { tags: parts.map(formatHashtag).filter(t => t !== ''), rest };
}

/** `current` with `tag` added: formatted, never twice, never past `max`. */
export function withHashtag(current: readonly string[], tag: string, max: number): string[] {
  const formatted = formatHashtag(tag);
  if (formatted === '' || current.length >= max || current.includes(formatted)) return [...current];
  return [...current, formatted];
}

/** A person's first name for the row ("Alex Morgan" → "Alex"). */
export function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] ?? '';
}

/** The Tag people row's label: nobody → "Tag people"; else the first two
 *  first names and how many more ("Alex, Sam +1"). */
export function tagRowLabel(names: readonly string[]): string {
  const firsts = names.map(firstNameOf).filter(n => n !== '');
  if (firsts.length === 0) return 'Tag people';
  const shown = firsts.slice(0, 2).join(', ');
  return firsts.length > 2 ? `${shown} +${firsts.length - 2}` : shown;
}
