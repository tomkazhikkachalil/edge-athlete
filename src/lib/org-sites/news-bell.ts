// A news post's bell text (sports-team website program, A1, Sep 28 2026) —
// pure. The message is the post's summary, else its first paragraph's WORDS
// (inline markup stripped), else a plain line; capped at Announce's 500.

import { inlineToPlain } from './inline';

export const NEWS_BELL_MAX = 500;

export function newsBellMessage(post: { summary?: string | null; body?: unknown }, orgName: string): string {
  let text = post.summary?.trim() || '';
  if (!text && Array.isArray(post.body)) {
    for (const b of post.body) {
      if (b && typeof b === 'object' && (b as { type?: string }).type === 'paragraph') {
        const words = inlineToPlain(String((b as { text?: unknown }).text ?? '')).trim();
        if (words) {
          text = words;
          break;
        }
      }
    }
  }
  if (!text) text = `A new post from ${orgName}.`;
  return text.length > NEWS_BELL_MAX ? `${text.slice(0, NEWS_BELL_MAX - 1)}…` : text;
}
