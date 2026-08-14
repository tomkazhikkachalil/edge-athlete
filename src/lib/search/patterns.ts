/**
 * Shared matching rule for the ILIKE-backed searches (golf courses today).
 *
 * Pure, so it is unit-testable under the node-only rule — unlike the SQL in
 * `search_people`, which encodes the same rule for people.
 */

import { WIDE_MATCH_MIN_CHARS } from './people';

/** Escape the PostgREST/SQL LIKE metacharacters in user input. */
export function escapeLikePattern(raw: string): string {
  // Backslash FIRST, or it would double-escape the escapes added after it.
  return raw.replace(/\\/g, '\\\\').replace(/[%_]/g, ch => `\\${ch}`);
}

/**
 * Prefix-only below `WIDE_MATCH_MIN_CHARS`, substring at or above it — the
 * same ladder `search_people` uses, and for the same two reasons:
 *
 *  1. A trigram index cannot serve a LIKE pattern shorter than 3 characters,
 *     so `%a%` is a sequential scan on the single most common query shape.
 *  2. It is the better answer anyway. `%a%` over `golf_rounds.course` matches
 *     very nearly every round ever logged, which is what made one-character
 *     course search useless noise rather than a suggestion.
 *
 * Returns a pattern ready for `.ilike()`.
 */
export function likePatternFor(rawQuery: string): string {
  const q = escapeLikePattern(rawQuery.trim());
  if (!q) return '%';
  return q.length < WIDE_MATCH_MIN_CHARS ? `${q}%` : `%${q}%`;
}
