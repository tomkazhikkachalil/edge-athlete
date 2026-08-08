'use client';

import { useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { useProfileSearch, type SearchProfile } from '@/hooks/useProfileSearch';

// Start a conversation from the dock: search-as-you-type over app users
// (same endpoint + debounce pattern as the full page's NewConversationModal)
// → create-or-reactivate the direct conversation server-side (blocks and
// messaging permissions enforced there) → open a mini window. If a
// conversation with the person already exists locally we skip the POST.

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
  const { query, setQuery, results, searching } = useProfileSearch({ excludeId: currentUserId });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

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
      <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-2">
        <input
          type="text"
          autoFocus
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a name or handle…"
          className="flex-1 px-3 py-1.5 bg-surface-muted border border-border rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button type="button" onClick={onCancel} className="text-xs text-muted hover:text-secondary">
          Cancel
        </button>
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-600 px-3 py-2 border-b border-border-subtle">{error}</p>
      )}
      <div className="flex-1 overflow-y-auto" style={{ minHeight: '8rem' }}>
        {searching && results.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">
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
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-brand-soft disabled:opacity-50"
              >
                <span className="w-8 h-8 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 shrink-0">
                  {profile.avatar_url ? (
                    <LazyImage src={profile.avatar_url} alt={name} className="w-full h-full object-cover" />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
                      {getInitials(name)}
                    </span>
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm text-primary truncate">{name}</span>
                  {profile.handle && (
                    <span className="block text-xs text-muted truncate">@{profile.handle}</span>
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
