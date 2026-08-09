/**
 * Thread-shape policy for post comments, as pure functions (the
 * composer-layout pattern: decisions here, DOM in the component, so the
 * policy is node-testable).
 *
 * Data keeps TRUE threading — parent_comment_id always points at the real
 * reply target, at any depth (the self-FK cascades deletes correctly). The
 * UI caps the VISUAL depth at three levels: roots (0), replies (1), and
 * everything deeper flattened at 2 — Tom's call, the Facebook model. A
 * reply below the cap reads as directed via the composer's @handle prefill
 * rather than another indent.
 */

/** Deepest visual indent level. Data depth is uncapped. */
export const MAX_VISUAL_DEPTH = 2;

export interface ThreadRow<T> {
  comment: T;
  /** Visual depth: 0 root, 1 reply, 2 = everything deeper, flattened. */
  depth: number;
}

interface ThreadNode {
  id: string;
}

/**
 * Flatten one root's subtree into render order: a depth-first walk where
 * each comment's replies follow it (chronological within each parent —
 * callers pre-sort repliesByParent), and any node deeper than
 * MAX_VISUAL_DEPTH is emitted AT the cap. Iterative on an explicit stack:
 * a maliciously deep reply chain must not blow the call stack.
 */
export function flattenReplies<T extends ThreadNode>(
  rootId: string,
  repliesByParent: Record<string, T[]>
): ThreadRow<T>[] {
  const out: ThreadRow<T>[] = [];
  // Stack of [comment, depth]; children pushed in reverse so the earliest
  // reply is processed first.
  const stack: Array<[T, number]> = [];
  const seed = repliesByParent[rootId] ?? [];
  for (let i = seed.length - 1; i >= 0; i--) stack.push([seed[i], 1]);

  while (stack.length > 0) {
    const [comment, depth] = stack.pop()!;
    out.push({ comment, depth: Math.min(depth, MAX_VISUAL_DEPTH) });
    const children = repliesByParent[comment.id];
    if (children) {
      for (let i = children.length - 1; i >= 0; i--) {
        stack.push([children[i], depth + 1]);
      }
    }
  }
  return out;
}

/**
 * Every descendant id of a comment (for local-state delete: the DB cascade
 * removes the subtree; the client must drop the same rows or grandchildren
 * linger until refetch). Iterative for the same stack-safety reason.
 */
export function collectDescendantIds<T extends ThreadNode>(
  commentId: string,
  repliesByParent: Record<string, T[]>
): Set<string> {
  const out = new Set<string>();
  const stack: string[] = [commentId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const children = repliesByParent[id];
    if (children) {
      for (const child of children) {
        if (!out.has(child.id)) {
          out.add(child.id);
          stack.push(child.id);
        }
      }
    }
  }
  return out;
}
