'use client';

import { useEffect, useRef, useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';

// Start a conversation from the dock: search-as-you-type over app users
// (same endpoint + debounce pattern as the full page's NewConversationModal)
// → create-or-reactivate the direct conversation server-side (blocks and
// messaging permissions enforced there) → open a mini window. If a
// conversation with the person already exists locally we skip the POST.

interface SearchProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

export default function DockComposer({
  currentUserId,
  existingDirectWith,
  onOpened,
  onCancel,
}: {
  currentUserId: string;
  existingDirectWith: (profileId: string) => string | null;
  onOpened: (conversationId: string) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const seqRef = useRef(0);

  // Clearing results for a too-short query is synchronisation (render phase);
  // the debounced fetch stays an effect.
  const [syncedQuery, setSyncedQuery] = useState(query);
  if (syncedQuery !== query) {
    setSyncedQuery(query);
    if (query.trim().length < 2) setResults([]);
    else setSearching(true);
  }

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=athletes`);
        if (!res.ok || seq !== seqRef.current) return;
        const data = await res.json();
        if (seq === seqRef.current) {
          setResults(
            ((data.results?.athletes ?? []) as SearchProfile[]).filter(p => p.id !== currentUserId)
          );
        }
      } catch {
        // typing again retries
      } finally {
        if (seq === seqRef.current) setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query, currentUserId]);

  const pick = async (profile: SearchProfile) => {
    if (creating) return;
    setError('');
    const existing = existingDirectWith(profile.id);
    if (existing) {
      onOpened(existing);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', participantId: profile.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not start the conversation.');
        return;
      }
      onOpened(data.conversationId);
    } catch {
      setError('Could not start the conversation. Please try again.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 border-b border-gray-100 flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a name or handle…"
          className="flex-1 px-3 py-1.5 bg-gray-50 border border-gray-200 rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button type="button" onClick={onCancel} className="text-xs text-gray-500 hover:text-gray-700">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 px-3 py-2 border-b border-gray-100">{error}</p>
      )}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: '8rem' }}>
        {searching && results.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-6">
            {query.trim().length < 2 ? 'Search for someone to message.' : 'No one found.'}
          </p>
        ) : (
          results.map(profile => {
            const name = formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name);
            return (
              <button
                key={profile.id}
                type="button"
                disabled={creating}
                onClick={() => pick(profile)}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-violet-50 disabled:opacity-50"
              >
                <span className="w-8 h-8 rounded-full overflow-hidden bg-violet-100 shrink-0">
                  {profile.avatar_url ? (
                    <LazyImage src={profile.avatar_url} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-violet-700">
                      {getInitials(name)}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-gray-900 truncate">{name}</span>
                  {profile.handle && (
                    <span className="block text-xs text-gray-500 truncate">@{profile.handle}</span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
