'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { arrivalAction, classifyListChange, distanceFromBottom, restoreAfterPrepend, shouldStickToBottom, type ListEdges } from './list-scroll';

/**
 * The ONE writer of the thread list's scrollTop (Tom's fix 6, Oct 14 2026;
 * the rules in list-scroll.ts). The list is a plain column (newest at the
 * DOM end); this hook lands the first load at the bottom, follows your own
 * and near-bottom arrivals, counts the others into the "New messages" pill,
 * keeps your place when older rows are prepended, sticks to the bottom as
 * the list or its content changes size (the keyboard, the composer growing,
 * an image loading) while you are there, and goes to the latest message
 * the moment the keyboard opens.
 */
export function useThreadScroll(args: {
  listRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
  newestId: string | null;
  oldestId: string | null;
  count: number;
  newestIsOwn: boolean;
  loading: boolean;
  keyboardOpen: boolean;
}): { unseenCount: number; scrollToBottom: (behavior?: ScrollBehavior) => void; beforePrepend: () => void; onScroll: () => void } {
  const { listRef, contentRef, newestId, oldestId, count, newestIsOwn, loading, keyboardOpen } = args;
  const [unseenCount, setUnseenCount] = useState(0);
  const nearBottomRef = useRef(true);
  const edgesRef = useRef<ListEdges>({ newestId: null, oldestId: null, count: 0 });
  const prependSnapRef = useRef<{ h: number; top: number } | null>(null);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'auto') => {
    const l = listRef.current;
    if (!l) return;
    l.scrollTo({ top: l.scrollHeight, behavior });
    nearBottomRef.current = true;
    setUnseenCount(0);
  }, [listRef]);

  const onScroll = useCallback(() => {
    const l = listRef.current;
    if (!l) return;
    const near = shouldStickToBottom(distanceFromBottom(l.scrollTop, l.scrollHeight, l.clientHeight));
    nearBottomRef.current = near;
    if (near) setUnseenCount(0);
  }, [listRef]);

  const beforePrepend = useCallback(() => {
    const l = listRef.current;
    if (l) prependSnapRef.current = { h: l.scrollHeight, top: l.scrollTop };
  }, [listRef]);

  useLayoutEffect(() => {
    if (loading) return;
    const next = { newestId, oldestId, count };
    const change = classifyListChange(edgesRef.current, next);
    edgesRef.current = next;
    const l = listRef.current;
    if (!l) return;
    if (change === 'prepended') {
      const snap = prependSnapRef.current;
      prependSnapRef.current = null;
      if (snap) l.scrollTop = restoreAfterPrepend(snap.h, snap.top, l.scrollHeight);
      return;
    }
    const action = arrivalAction({ change, isOwn: newestIsOwn, nearBottom: nearBottomRef.current });
    if (action === 'scroll') scrollToBottom(change === 'initial' ? 'auto' : 'smooth');
    else if (action === 'pill') setUnseenCount(n => n + 1);
  }, [newestId, oldestId, count, loading, newestIsOwn, listRef, scrollToBottom]);

  useEffect(() => {
    const l = listRef.current;
    if (!l || typeof ResizeObserver !== 'function') return;
    const ro = new ResizeObserver(() => {
      if (nearBottomRef.current) l.scrollTop = l.scrollHeight;
    });
    ro.observe(l);
    const c = contentRef.current;
    if (c) ro.observe(c);
    return () => ro.disconnect();
  }, [listRef, contentRef, loading]);

  useEffect(() => {
    if (keyboardOpen) scrollToBottom('auto');
  }, [keyboardOpen, scrollToBottom]);

  return { unseenCount, scrollToBottom, beforePrepend, onScroll };
}
