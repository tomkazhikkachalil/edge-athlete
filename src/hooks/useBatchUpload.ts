'use client';

/**
 * The guardian batch upload's run loop (Wave 5). One camera roll → N posts
 * across the household: each (athlete × confirmed-event-or-null) group
 * becomes one post on that athlete's profile, honestly attributed
 * (created_by = the guardian, via targetProfileId).
 *
 * Shape rules, all inherited from surfaces that learned them the hard way:
 *  - SEQUENTIAL, never Promise.all — a phone connection failing on the
 *    fourth file must not vaporize the first three (RoundMediaManager).
 *  - Partial success is reported truthfully: posts created, items failed,
 *    never "done!" over a half-run.
 *  - An item shared across athletes is uploaded ONCE (to the first
 *    athlete's prefix) then server-COPIED per extra athlete — never a
 *    shared storage object, never a client re-upload loop.
 */

import { useCallback, useRef, useState } from 'react';
import { uploadPostMedia } from '@/lib/media/upload';

export interface BatchRunItem {
  id: string;
  /** Editor-rendered file to upload. */
  file: File;
  kind: 'image' | 'video';
  posterBlob?: Blob;
  durationSeconds?: number;
}

export interface BatchRunGroup {
  athleteId: string;
  /** Guardian-CONFIRMED event, or null. Never a raw suggestion. */
  eventId: string | null;
  itemIds: string[];
}

export interface BatchProgress {
  done: number;
  total: number;
}

export interface BatchOutcome {
  postsCreated: number;
  eventsAttached: number;
  /** Human-readable per-failure messages (first shown, count reported). */
  failures: string[];
}

interface UploadedItem {
  url: string;
  type: 'image' | 'video';
  thumbnailUrl: string | null;
  /** Whose storage prefix holds these bytes. */
  ownerAthleteId: string;
}

async function copyMedia(sourceUrl: string, targetProfileId: string): Promise<string> {
  const res = await fetch('/api/upload/post-media/copy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ sourceUrl, targetProfileId }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.url) throw new Error(data.error || 'Could not copy the media');
  return data.url as string;
}

export function useBatchUpload() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [outcome, setOutcome] = useState<BatchOutcome | null>(null);
  // Guards a double-tap on Start: state alone lags a render behind.
  const runningRef = useRef(false);

  const run = useCallback(
    async (items: BatchRunItem[], groups: BatchRunGroup[], caption: string) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunning(true);
      setOutcome(null);
      setProgress({ done: 0, total: groups.length });

      const itemById = new Map(items.map(i => [i.id, i]));
      const uploaded = new Map<string, UploadedItem>();
      const failures: string[] = [];
      // An item that failed its FIRST upload is dead for every group —
      // retrying it per group would burn rate-limit tokens on a lost cause.
      const deadItems = new Set<string>();
      let postsCreated = 0;
      let eventsAttached = 0;
      let done = 0;

      for (const group of groups) {
        const media: Array<{ url: string; type: string; thumbnailUrl?: string; duration?: number }> =
          [];
        for (const itemId of group.itemIds) {
          const item = itemById.get(itemId);
          if (!item || deadItems.has(itemId)) continue;
          try {
            let existing = uploaded.get(itemId);
            if (!existing) {
              const primary = await uploadPostMedia(item.file, group.athleteId);
              let thumbnailUrl: string | null = null;
              if (item.posterBlob) {
                // Cover frame never blocks the media itself (house rule).
                try {
                  const poster = new File([item.posterBlob], 'poster.jpg', { type: 'image/jpeg' });
                  thumbnailUrl = (await uploadPostMedia(poster, group.athleteId)).url;
                } catch (e) {
                  console.warn('[batch] poster upload failed:', e);
                }
              }
              existing = {
                url: primary.url,
                type: primary.type,
                thumbnailUrl,
                ownerAthleteId: group.athleteId,
              };
              uploaded.set(itemId, existing);
              media.push({
                url: existing.url,
                type: existing.type,
                ...(existing.thumbnailUrl ? { thumbnailUrl: existing.thumbnailUrl } : {}),
                ...(item.durationSeconds ? { duration: item.durationSeconds } : {}),
              });
            } else if (existing.ownerAthleteId === group.athleteId) {
              // Same athlete, second group (different event) — same bytes.
              media.push({
                url: existing.url,
                type: existing.type,
                ...(existing.thumbnailUrl ? { thumbnailUrl: existing.thumbnailUrl } : {}),
                ...(item.durationSeconds ? { duration: item.durationSeconds } : {}),
              });
            } else {
              // Another athlete: fresh objects under THEIR prefix.
              const url = await copyMedia(existing.url, group.athleteId);
              let thumbnailUrl: string | null = null;
              if (existing.thumbnailUrl) {
                try {
                  thumbnailUrl = await copyMedia(existing.thumbnailUrl, group.athleteId);
                } catch (e) {
                  console.warn('[batch] poster copy failed:', e);
                }
              }
              media.push({
                url,
                type: existing.type,
                ...(thumbnailUrl ? { thumbnailUrl } : {}),
                ...(item.durationSeconds ? { duration: item.durationSeconds } : {}),
              });
            }
          } catch (e) {
            if (!uploaded.has(itemId)) deadItems.add(itemId);
            failures.push(e instanceof Error ? e.message : 'Upload failed');
          }
        }

        if (media.length > 0) {
          try {
            const res = await fetch('/api/posts', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({
                postType: 'general',
                caption,
                visibility: 'public',
                media,
                targetProfileId: group.athleteId,
                ...(group.eventId ? { eventId: group.eventId } : {}),
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || 'Could not create the post');
            postsCreated += 1;
            if (group.eventId) eventsAttached += 1;
          } catch (e) {
            failures.push(e instanceof Error ? e.message : 'Could not create the post');
          }
        } else if (group.itemIds.length > 0) {
          failures.push('No media survived for one of the posts');
        }

        done += 1;
        setProgress({ done, total: groups.length });
      }

      const result: BatchOutcome = { postsCreated, eventsAttached, failures };
      setOutcome(result);
      setRunning(false);
      runningRef.current = false;
      return result;
    },
    []
  );

  return { run, running, progress, outcome };
}
