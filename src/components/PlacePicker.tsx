'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useTypeahead } from '@/hooks/useTypeahead';
import type { PlaceSuggestion } from '@/app/api/places/route';

/**
 * The one location input (docs/SEARCH.md): free text with place
 * suggestions from `/api/places` (GeoNames via migration 104). Picking a
 * suggestion yields a structured PlaceValue — city/region/country with ISO
 * codes and coordinates — which is what makes an entity searchable and
 * filterable by location. Typing without picking keeps free text: a legal,
 * un-structured state (the picker never blocks a save), and what every
 * profile has until its owner picks a place.
 *
 * Used by Edit Profile (location), the header search's Location filter and
 * Explore's athlete filter; the club/league forms adopt it on creation.
 */
export interface PlaceValue {
  placeId: string;
  city: string;
  region: string | null;
  regionCode: string | null;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
  label: string;
}

interface PlacePickerProps {
  id?: string;
  /** The structured pick, or null when the text is free-form. */
  value: PlaceValue | null;
  /** The text shown in the box (the pick's label, or whatever was typed). */
  text: string;
  onChange: (value: PlaceValue | null, text: string) => void;
  placeholder?: string;
  /** Restrict suggestions to one country (ISO-2). */
  countryCode?: string;
  className?: string;
  /** Free text allowed (profile) vs. pick-only (filters). */
  allowFreeText?: boolean;
  disabled?: boolean;
}

export default function PlacePicker({
  id,
  value,
  text,
  onChange,
  placeholder = 'City or town',
  countryCode,
  className,
  allowFreeText = true,
  disabled = false,
}: PlacePickerProps) {
  const autoId = useId();
  const inputId = id ?? `place-${autoId}`;
  const listId = `${inputId}-list`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const { query, setQuery, items, loading, activeIndex, setActiveIndex, onKeyDown, reset } =
    useTypeahead<PlaceSuggestion>({
      scope: `places:${countryCode ?? 'all'}`,
      minChars: 2,
      fetcher: async (q, signal) => {
        const params = new URLSearchParams({ q });
        if (countryCode) params.set('country', countryCode);
        const res = await fetch(`/api/places?${params}`, { signal });
        if (!res.ok) return [];
        return ((await res.json()).places ?? []) as PlaceSuggestion[];
      },
    });

  // Keep the hook's query in step with the controlled text (a parent may
  // reset it after a save or a Clear All).
  useEffect(() => {
    if (query !== text) setQuery(text);
    // setQuery is stable; syncing on `text` only is the intent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const pick = (p: PlaceSuggestion) => {
    onChange(
      {
        placeId: p.id,
        city: p.name,
        region: p.region,
        regionCode: p.regionCode,
        country: p.country,
        countryCode: p.countryCode,
        lat: p.lat,
        lng: p.lng,
        label: p.label,
      },
      p.label
    );
    reset();
    setQuery(p.label);
    setOpen(false);
  };

  const showList = open && items.length > 0;

  return (
    <div ref={wrapRef} className="relative">
      <input
        id={inputId}
        type="text"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={text}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onChange={e => {
          const next = e.target.value;
          setQuery(next);
          setOpen(true);
          // Any edit invalidates a structured pick — the text no longer
          // describes the chosen place.
          onChange(allowFreeText ? null : value && next === value.label ? value : null, next);
        }}
        onKeyDown={e => {
          if (onKeyDown(e)) return;
          if (e.key === 'Enter' && showList && activeIndex >= 0) {
            e.preventDefault();
            pick(items[activeIndex]);
          } else if (e.key === 'Escape') {
            setOpen(false);
          }
        }}
        className={
          className ??
          'w-full px-3 py-2 border border-border-strong rounded-md focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'
        }
      />
      {value && (
        <i
          className="fas fa-map-marker-alt absolute right-3 top-1/2 -translate-y-1/2 text-xs text-brand-fg"
          aria-hidden="true"
          title="Linked to a place"
        ></i>
      )}
      {loading && !showList && (
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          <div className="animate-spin rounded-full h-3.5 w-3.5 border-b-2 border-brand"></div>
        </div>
      )}
      {showList && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-30 mt-1 w-full max-h-60 overflow-y-auto overscroll-contain rounded-lg border border-border-strong bg-surface-raised shadow-lg"
        >
          {items.map((p, i) => (
            <li
              key={p.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === activeIndex}
              onMouseEnter={() => setActiveIndex(i)}
              onMouseDown={e => {
                e.preventDefault(); // keep focus; the click picks
                pick(p);
              }}
              className={`cursor-pointer px-3 py-2 text-sm ${
                i === activeIndex ? 'bg-brand/10 text-primary' : 'text-secondary'
              }`}
            >
              <span className="font-medium text-primary">{p.name}</span>
              <span className="text-tertiary">
                {[p.region, p.country].filter(Boolean).length ? ` — ${[p.region, p.country].filter(Boolean).join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      {allowFreeText && !value && text.trim() && !showList && !loading && (
        <p className="mt-1 text-[10px] text-faint">Pick a suggestion to make your location searchable, or keep it as typed.</p>
      )}
    </div>
  );
}
