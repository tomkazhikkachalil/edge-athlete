'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { MAX_GUESTS } from '@/lib/calendar/events';

export interface GuestChip {
  kind: 'profile' | 'email';
  id: string; // profile id or the email itself
  label: string;
  handle?: string | null;
  avatarUrl?: string | null;
}

interface SearchProfile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Chip input: search-as-you-type over app users (public + accepted follows,
// via /api/calendar/invite-search) plus "Invite <email>" for addresses.
export default function GuestPicker({
  chips,
  onChange,
}: {
  chips: GuestChip[];
  onChange: (chips: GuestChip[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchProfile[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Clearing results for a too-short query is synchronisation (render phase);
  // the debounced fetch stays an effect.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    if (query.trim().length < 2) setResults([]);
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/calendar/invite-search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();
        setResults(data.profiles ?? []);
        setOpen(true);
      } catch {
        // best-effort; typing again retries
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const add = (chip: GuestChip) => {
    setError('');
    if (chips.some(c => c.kind === chip.kind && c.id === chip.id)) return;
    if (chips.length >= MAX_GUESTS) {
      setError(`Events can have at most ${MAX_GUESTS} guests.`);
      return;
    }
    onChange([...chips, chip]);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const remove = (chip: GuestChip) => {
    onChange(chips.filter(c => !(c.kind === chip.kind && c.id === chip.id)));
  };

  const trimmed = query.trim().toLowerCase();
  const emailCandidate = EMAIL_RE.test(trimmed) ? trimmed : null;

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap gap-1.5 border border-gray-300 rounded-lg px-2 py-2 focus-within:ring-2 focus-within:ring-violet-500">
        {chips.map(chip => (
          <span
            key={`${chip.kind}:${chip.id}`}
            className={`inline-flex items-center gap-1 rounded-full pl-2 pr-1 py-0.5 text-xs font-medium ${
              chip.kind === 'email' ? 'bg-gray-100 text-gray-700' : 'bg-violet-100 text-violet-700'
            }`}
          >
            {chip.kind === 'email' && <i className="fas fa-envelope text-gray-400"></i>}
            {chip.label}
            <button
              type="button"
              onClick={() => remove(chip)}
              aria-label={`Remove ${chip.label}`}
              className="w-4 h-4 rounded-full hover:bg-black/10 flex items-center justify-center"
            >
              <i className="fas fa-xmark text-[10px]"></i>
            </button>
          </span>
        ))}
        <input
          type="text"
          value={query}
          onChange={e => { setQuery(e.target.value); setError(''); }}
          onFocus={() => { if (results.length > 0 || emailCandidate) setOpen(true); }}
          placeholder={chips.length === 0 ? 'Type a name or email…' : ''}
          className="flex-grow min-w-28 text-sm outline-none py-0.5"
        />
      </div>
      {error && <p className="text-xs text-red-600 mt-1" role="alert">{error}</p>}

      {open && (results.length > 0 || emailCandidate) && (
        <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-30 max-h-56 overflow-y-auto">
          {results.map(p => {
            const name = formatDisplayName(p.first_name, null, p.last_name, p.full_name);
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => add({ kind: 'profile', id: p.id, label: name, handle: p.handle, avatarUrl: p.avatar_url })}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-50"
              >
                <span className="relative w-7 h-7 rounded-full overflow-hidden bg-violet-100 flex items-center justify-center shrink-0">
                  {p.avatar_url ? (
                    <Image
                      src={p.avatar_url}
                      alt=""
                      fill
                      sizes="28px"
                      className="object-cover"
                      unoptimized={!isOptimizableImageSrc(p.avatar_url)}
                    />
                  ) : (
                    <span className="text-[10px] font-semibold text-violet-700">{getInitials(name)}</span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900 truncate">{name}</span>
                  {p.handle && <span className="block text-xs text-gray-500 truncate">@{p.handle}</span>}
                </span>
              </button>
            );
          })}
          {emailCandidate && (
            <button
              type="button"
              onClick={() => add({ kind: 'email', id: emailCandidate, label: emailCandidate })}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-violet-50 border-t border-gray-100"
            >
              <span className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                <i className="fas fa-envelope text-gray-400 text-xs"></i>
              </span>
              <span className="text-sm text-gray-900">Invite {emailCandidate} by email</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
