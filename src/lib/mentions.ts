/**
 * @mention parsing — pure functions shared by comments and chat (rendering,
 * typeahead triggering, caret splicing, and the server-side handle extract).
 *
 * The token grammar mirrors the handle grammar (handle-validation.ts):
 * 3-20 chars of [a-z0-9._], starting AND ending alphanumeric, no
 * consecutive separators enforced at handle creation (a token may still
 * match a nonexistent handle — resolution decides what's real; unresolved
 * tokens render as plain/styled text, which is also how chat's deliberate
 * "dummy" mentions work).
 */

/** One parsed segment of a text: literal text or an @token. */
export interface MentionSegment {
  type: 'text' | 'mention';
  /** The raw slice of the input (for mentions, includes the '@'). */
  value: string;
  /** Lowercased handle without '@' — mentions only. */
  handle?: string;
}

// '@' must not be glued to a preceding word/handle character (else
// email@domain would tokenize). The body: alnum, then up to 18 of
// [a-z0-9._], ending alnum — i.e. 2..20 chars total, matching the handle
// grammar's bounds (single-char handles don't exist).
const MENTION_RE = /(^|[^a-z0-9._@])@([a-z0-9][a-z0-9._]{0,18}[a-z0-9])/gi;

/** Split text into literal and mention segments. */
export function parseMentionTokens(text: string): MentionSegment[] {
  const out: MentionSegment[] = [];
  let last = 0;
  MENTION_RE.lastIndex = 0;
  for (let m = MENTION_RE.exec(text); m !== null; m = MENTION_RE.exec(text)) {
    const start = m.index + m[1].length; // skip the boundary char
    if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
    out.push({ type: 'mention', value: `@${m[2]}`, handle: m[2].toLowerCase() });
    last = start + 1 + m[2].length;
  }
  if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
  return out;
}

/** Unique lowercased handles mentioned in a text. */
export function extractHandles(text: string): string[] {
  const seen = new Set<string>();
  for (const seg of parseMentionTokens(text)) {
    if (seg.type === 'mention' && seg.handle) seen.add(seg.handle);
  }
  return [...seen];
}

export interface ActiveMentionToken {
  /** Index of the '@' in the text. */
  start: number;
  /** What's typed after the '@' so far (may be empty), lowercased. */
  query: string;
}

/**
 * The typeahead trigger: is the caret currently inside/right after an
 * @token being typed? Returns null when it isn't (mid-word '@' as in
 * emails, caret elsewhere, token already terminated by whitespace).
 */
export function findActiveMentionToken(
  text: string,
  caretPos: number
): ActiveMentionToken | null {
  const upto = text.slice(0, caretPos);
  const at = upto.lastIndexOf('@');
  if (at === -1) return null;
  // '@' must sit at a word boundary (start or after a non-handle char).
  if (at > 0 && /[a-z0-9._@]/i.test(upto[at - 1])) return null;
  const query = upto.slice(at + 1);
  // Anything that can't be part of a handle terminates the token.
  if (/[^a-z0-9._]/i.test(query)) return null;
  if (query.length > 20) return null;
  return { start: at, query: query.toLowerCase() };
}

/**
 * Replace the active @token with the chosen handle plus a trailing space;
 * returns the new text and caret position.
 */
export function spliceMention(
  text: string,
  tokenStart: number,
  caretPos: number,
  handle: string
): { text: string; caret: number } {
  const inserted = `@${handle} `;
  const next = text.slice(0, tokenStart) + inserted + text.slice(caretPos);
  return { text: next, caret: tokenStart + inserted.length };
}
