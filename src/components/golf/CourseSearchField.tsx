'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { usePopoverDismiss } from '@/hooks/usePopoverDismiss';
import type { GolfCourse } from '@/types/golf';

/**
 * A course picker over the catalog (Events program, extracted from the
 * composer's search in GolfComposerSection): debounced, abortable
 * typeahead on /api/golf/courses, a thin row hydrated on selection (one
 * detail fetch fills ratings and holes), and "Use “X” as typed" for an
 * off-catalog course. The composer keeps its worldwide search and the
 * multi-course section chooser — the wizard needs neither.
 */
interface Props {
  /** The current pick, or null. */
  value: { id: string | null; name: string } | null;
  onSelect: (course: GolfCourse | null, typedName?: string) => void;
  placeholder?: string;
  id?: string;
}

const isThin = (c: GolfCourse) => c.holes.length === 0 && Object.keys(c.courseRating ?? {}).length === 0;

export default function CourseSearchField({ value, onSelect, placeholder = 'Search courses', id }: Props) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<GolfCourse[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const fieldRef = useRef<HTMLDivElement>(null);

  const run = useCallback(async (signal: AbortSignal, q: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/golf/courses?q=${encodeURIComponent(q)}&limit=12`, { signal });
      if (res.ok) {
        const data = await res.json();
        setResults((data.courses ?? []) as GolfCourse[]);
        setFailed(false);
      } else {
        setFailed(true);
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      setFailed(true);
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, []);
  const [debounced, cancel] = useDebouncedCallback(run);

  const close = useCallback(() => { setOpen(false); setResults([]); cancel(); }, [cancel]);
  usePopoverDismiss(fieldRef, open, close);

  useEffect(() => () => cancel(), [cancel]);

  const pick = async (course: GolfCourse) => {
    close();
    setQuery('');
    let full = course;
    if (isThin(course)) {
      try {
        const res = await fetch(`/api/golf/courses?id=${encodeURIComponent(course.id)}`);
        if (res.ok) full = ((await res.json()).course as GolfCourse) ?? course;
      } catch { /* the thin row is still a real pick */ }
    }
    onSelect(full);
  };

  if (value) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-border-strong bg-surface px-3 min-h-[44px]" data-course-picked={value.id ?? 'typed'}>
        <span className="text-sm text-primary truncate">{value.name}{value.id ? '' : ' (as typed)'}</span>
        <button type="button" onClick={() => onSelect(null)} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] shrink-0">Change</button>
      </div>
    );
  }

  const typed = query.trim();
  return (
    <div ref={fieldRef} className="relative">
      <input
        id={id}
        type="search"
        value={query}
        autoComplete="off"
        placeholder={placeholder}
        role="combobox"
        aria-label="Course"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="course-search-options"
        onChange={e => {
          const q = e.target.value;
          setQuery(q);
          setOpen(true);
          if (q.trim().length === 0) { cancel(); setResults([]); return; }
          debounced(q.trim());
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => { if (e.key === 'Enter' && typed) { e.preventDefault(); close(); onSelect(null, typed); setQuery(''); } }}
        className="w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base"
        data-course-search=""
      />
      {open && (typed.length > 0) && (
        <div id="course-search-options" className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-border bg-surface-raised shadow-lg" role="listbox">
          {loading && results.length === 0 && <p className="px-3 py-2 text-sm text-muted">Searching…</p>}
          {failed && <p className="px-3 py-2 text-sm text-red-700 dark:text-red-300">Course search is unavailable right now — type the name instead.</p>}
          {results.map(c => (
            <button key={c.id} type="button" role="option" aria-selected={false} onClick={() => pick(c)} className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-surface-muted" data-course-option={c.id}>
              <span className="block text-sm font-medium text-primary truncate">{c.name}</span>
              <span className="block text-xs text-muted truncate">{[c.city, c.state, c.country].filter(Boolean).join(', ')}{c.source === 'osm' ? ' · no hole data' : ''}</span>
            </button>
          ))}
          <button type="button" role="option" aria-selected={false} onClick={() => { close(); onSelect(null, typed); setQuery(''); }} className="w-full text-left px-3 py-2 min-h-[44px] hover:bg-surface-muted border-t border-border-subtle" data-course-typed="">
            <span className="text-sm text-secondary">Use “{typed}” as typed</span>
          </button>
        </div>
      )}
    </div>
  );
}
