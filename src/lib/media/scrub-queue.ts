/**
 * Single-flight queue for the upload scrubbers (pure — unit-tested in
 * scrub-queue.test.ts).
 *
 * Why (Sep 2026): the orientation bake in upload.ts is a full-resolution
 * decode + canvas re-encode, and the video scrub holds a whole re-muxed file
 * in memory. Both are fine ONE at a time — the editor already decodes every
 * photo at full size when it opens — but the composer uploads its media in
 * parallel, so a three-photo phone post ran three 12MP bakes at once. That is
 * exactly what export.ts forbids ("ten simultaneous 12MP decodes is how
 * mobile Safari tabs die"), and it did: jank, then a tab reload that lost the
 * post. This chain guarantees at most one scrub is alive regardless of how
 * many callers race; the network request stays outside it so uploads still
 * overlap.
 *
 * A rejected task never poisons the chain: the next task still runs.
 */

let tail: Promise<void> = Promise.resolve();

export function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = tail.then(task);
  tail = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}
