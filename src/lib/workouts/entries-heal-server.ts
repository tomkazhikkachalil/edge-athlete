import { healStoredMediaUrl } from '@/lib/media/proxy-url';

/**
 * Before the pure validator sees an entries payload (the editor's PUT, the
 * manual POST): every set-media URL that is a media-proxy path — the shape
 * the workouts GET hands the editor — becomes the stored storage URL again.
 * Server-only (verifying the token needs the secret). An unverifiable
 * proxied path is left as it is and the validator refuses it by name.
 * The 48 h local drafts (src/lib/workouts/draft.ts) already hold proxied
 * paths, which is why this heals rather than refuses.
 */
export function healEntriesMedia(exercises: unknown): unknown {
  if (!Array.isArray(exercises)) return exercises;
  return exercises.map(exercise => {
    if (typeof exercise !== 'object' || exercise === null) return exercise;
    const ex = exercise as { sets?: unknown };
    if (!Array.isArray(ex.sets)) return exercise;
    return {
      ...ex,
      sets: ex.sets.map(set => {
        if (typeof set !== 'object' || set === null) return set;
        const s = set as { media?: unknown };
        if (!Array.isArray(s.media)) return set;
        return {
          ...s,
          media: s.media.map(item => {
            if (typeof item !== 'object' || item === null) return item;
            const m = item as { url?: unknown };
            if (typeof m.url !== 'string') return item;
            return { ...m, url: healStoredMediaUrl(m.url) ?? m.url };
          }),
        };
      }),
    };
  });
}

/** The stored URLs of a set-media list (jsonb value), proxied paths healed —
 *  for the readers that parse storage paths (the sweep, the deletion engine). */
export function healSetMediaValue(media: unknown): unknown {
  if (!Array.isArray(media)) return media;
  return media.map(item => {
    if (typeof item !== 'object' || item === null) return item;
    const m = item as { url?: unknown };
    if (typeof m.url !== 'string') return item;
    return { ...m, url: healStoredMediaUrl(m.url) ?? m.url };
  });
}
