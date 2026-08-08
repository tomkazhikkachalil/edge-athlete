/**
 * Is this post's caption the one the app wrote for itself?
 *
 * A shared round created from the composer gets `title: \`Golf at ${course}\``
 * (CreatePostModal), and the API stores `caption: description || title`
 * (api/group-posts/route.ts) — so a round the athlete didn't caption ends up
 * with prose that only restates the course name.
 *
 * That was harmless until the feed card started showing the course itself. A
 * golf post with a photo now renders the course in the media strip, again in
 * this caption, and again in the stat card below — three times in one card.
 * This lets the card drop the copy that carries no information.
 *
 * MATCHES EXACTLY, deliberately. Anything the athlete actually typed — even
 * "Golf at Eagle Creek with the boys" — is theirs and must survive; only the
 * template verbatim is dropped. Comparison ignores case and collapses
 * whitespace, because those are typographic noise, not authorship.
 */

const AUTO_PREFIX = 'golf at';

function normalise(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isAutoRoundCaption(
  caption: string | null | undefined,
  courseName: string | null | undefined
): boolean {
  if (!caption || !courseName) return false;
  const course = normalise(courseName);
  if (!course) return false;
  return normalise(caption) === `${AUTO_PREFIX} ${course}`;
}
