// ── A serial queue (pure) ───────────────────────────────────────────────────
// Runs async tasks strictly one after another, in the order they were added:
// a task starts only when every earlier one has settled, whether it resolved
// or threw. Each caller gets its own task's result.
//
// Why (Oct 1 2026): theme saves are last-write-wins PATCHes of the WHOLE
// prefs object. Two edits made in quick succession sent two overlapping
// requests, and on a real network the older one could arrive last and
// overwrite the newer — found by the first production probe of the schedule
// hours (staging's round trip is too fast to cross). Anything that persists
// whole-object state from rapid UI edits wants this.

export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    // The chain must survive a failed task; the caller still sees the rejection.
    tail = run.catch(() => undefined);
    return run;
  };
}
