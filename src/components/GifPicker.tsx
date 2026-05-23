'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface GifItem {
  id: string;
  url: string;
  preview_url: string;
  width: number;
  height: number;
}

interface Props {
  onGifSelect: (gifUrl: string) => void;
  onClose: () => void;
  /** 'popover' = small absolute-positioned dropdown (default). 'modal' = fills parent container. */
  variant?: 'popover' | 'modal';
}

const RECENT_GIFS_KEY = 'ea:msg:recentGifs';
const RECENT_GIFS_MAX = 12;

function readRecentGifs(): GifItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(RECENT_GIFS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((g): g is GifItem =>
        g && typeof g === 'object'
        && typeof g.id === 'string'
        && typeof g.url === 'string'
        && typeof g.preview_url === 'string'
      )
      .slice(0, RECENT_GIFS_MAX);
  } catch {
    return [];
  }
}

function writeRecentGifs(next: GifItem[]) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(RECENT_GIFS_KEY, JSON.stringify(next.slice(0, RECENT_GIFS_MAX)));
  } catch {
    // localStorage quota / private-mode failures are non-critical
  }
}

function rememberGif(gif: GifItem) {
  const current = readRecentGifs();
  const next = [gif, ...current.filter(g => g.id !== gif.id)].slice(0, RECENT_GIFS_MAX);
  writeRecentGifs(next);
}

export default function GifPicker({ onGifSelect, onClose, variant = 'popover' }: Props) {
  const [query, setQuery] = useState('');
  const [gifs, setGifs] = useState<GifItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [recents, setRecents] = useState<GifItem[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load recents once on mount
  useEffect(() => {
    setRecents(readRecentGifs());
  }, []);

  const fetchGifs = useCallback(async (q: string) => {
    setLoading(true);
    setError('');
    try {
      const url = q.trim()
        ? `/api/gifs/search?q=${encodeURIComponent(q.trim())}`
        : `/api/gifs/search`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to load GIFs');
      const data = await res.json();
      setGifs(data.gifs || []);
    } catch (e) {
      console.error('Failed to load GIFs:', e);
      setError('Could not load GIFs. Check your connection.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Load trending on mount
  useEffect(() => {
    fetchGifs('');
  }, [fetchGifs]);

  // Debounce search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchGifs(query), 400);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, fetchGifs]);

  // Close on outside click or Escape
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        onClose();
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  const isModal = variant === 'modal';
  const cols = isModal ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2';
  const thumbH = isModal ? 110 : 80;
  const skeletonCount = isModal ? 9 : 6;

  return (
    <div
      ref={containerRef}
      className={
        isModal
          ? 'flex flex-col overflow-hidden h-full'
          : 'absolute bottom-full mb-2 left-0 w-72 bg-white rounded-xl shadow-xl border border-gray-200 z-50 flex flex-col overflow-hidden'
      }
      style={isModal ? undefined : { maxHeight: 360 }}
    >
      {/* Search */}
      <div className="p-2 border-b border-gray-100 shrink-0">
        <div className="relative">
          <i className="fas fa-search absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search GIFs…"
            className={`w-full pl-8 pr-3 bg-gray-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
              isModal ? 'py-2.5 text-base' : 'py-1.5'
            }`}
            autoFocus
          />
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2">
        {/* Recent GIFs strip — only visible when there's no active search query */}
        {!query.trim() && recents.length > 0 && (
          <div className="mb-2 pb-2 border-b border-gray-100">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5 px-1">Recent</p>
            <div className={`grid ${cols} gap-1.5`}>
              {recents.map(gif => (
                <button
                  key={`recent-${gif.id}`}
                  type="button"
                  onClick={() => {
                    rememberGif(gif);
                    onGifSelect(gif.url);
                    onClose();
                  }}
                  className="rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={gif.preview_url}
                    alt="Recent GIF"
                    className="w-full object-cover"
                    style={{ height: thumbH }}
                    loading="lazy"
                  />
                </button>
              ))}
            </div>
          </div>
        )}

        {loading ? (
          <div className={`grid ${cols} gap-1.5`}>
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <div key={i} className="bg-gray-100 rounded-lg animate-pulse" style={{ height: thumbH }} />
            ))}
          </div>
        ) : error ? (
          <p className="text-center text-sm text-red-500 py-8">{error}</p>
        ) : gifs.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-8">No GIFs found</p>
        ) : (
          <div className={`grid ${cols} gap-1.5`}>
            {gifs.map(gif => (
              <button
                key={gif.id}
                type="button"
                onClick={() => {
                  rememberGif(gif);
                  onGifSelect(gif.url);
                  onClose();
                }}
                className="rounded-lg overflow-hidden hover:ring-2 hover:ring-blue-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={gif.preview_url}
                  alt="GIF"
                  className="w-full object-cover"
                  style={{ height: thumbH }}
                  loading="lazy"
                />
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Giphy attribution (required by Giphy TOS) */}
      <div className="px-3 py-1.5 border-t border-gray-100 shrink-0">
        <p className="text-xs text-gray-400 text-center">Powered by GIPHY</p>
      </div>
    </div>
  );
}
