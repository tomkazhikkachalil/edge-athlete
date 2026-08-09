'use client';

import Link from 'next/link';
import { parseMentionTokens } from '@/lib/mentions';

export interface MentionResolvedProfile {
  id: string;
  handle: string;
}

interface Props {
  text: string;
  /**
   * Maps a lowercased handle to a profile, or null when the token isn't a
   * real mention. Comments resolve against the hydrated mentions of the
   * comment; chat resolves against the conversation's participants.
   */
  resolve: (handle: string) => MentionResolvedProfile | null;
  /**
   * Chat styles unresolved tokens as inert emphasis (deliberate "dummy"
   * mentions of people outside the room); comments leave them as plain text.
   */
  styleUnresolved?: boolean;
}

/**
 * Renders user text with @mention tokens. Resolved mentions become profile
 * links; everything else stays literal text (the caller's <p> keeps
 * whitespace-pre-wrap break-words semantics — this component emits only
 * inline elements).
 */
export default function MentionText({ text, resolve, styleUnresolved }: Props) {
  const segments = parseMentionTokens(text);
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.type === 'mention' && seg.handle) {
          const profile = resolve(seg.handle);
          if (profile) {
            return (
              <Link
                key={i}
                href={`/u/@${profile.handle}`}
                className="font-semibold text-brand-fg hover:text-brand-fg-strong hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {seg.value}
              </Link>
            );
          }
          if (styleUnresolved) {
            return (
              <span key={i} className="font-semibold text-brand-fg">
                {seg.value}
              </span>
            );
          }
        }
        return <span key={i}>{seg.value}</span>;
      })}
    </>
  );
}
