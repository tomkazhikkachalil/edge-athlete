'use client';

import { useState, useEffect, useMemo } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import type { Conversation, ConversationParticipant } from '@/types/messages';

interface Props {
  conversation: Conversation;
  currentUserId: string;
  onClose: () => void;
  onUpdated: (updated: Partial<Conversation>) => void;
  onLeft: () => void;
}

export default function GroupSettingsModal({ conversation, currentUserId, onClose, onUpdated, onLeft }: Props) {
  const [name, setName] = useState(conversation.name || '');
  const [saving, setSaving] = useState(false);
  const [savingName, setSavingName] = useState(false);
  const [error, setError] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; avatar_url: string | null; handle: string | null }[]>([]);
  const [searching, setSearching] = useState(false);

  const myParticipant = conversation.my_participant;
  const isAdmin = myParticipant?.role === 'admin';
  // Memoized: this array is a dependency of the search-debounce effect below —
  // a fresh identity every render would re-trigger the effect in a loop.
  const activeParticipants = useMemo(
    () => conversation.participants.filter(p => !p.left_at),
    [conversation.participants]
  );

  // Mirrors a prop — synchronise during render so the old name never paints.
  const [syncedName, setSyncedName] = useState(conversation.name);
  if (syncedName !== conversation.name) {
    setSyncedName(conversation.name);
    setName(conversation.name || '');
  }

  // Clearing results for an empty query is synchronisation — do it during
  // render so stale hits never paint. The debounced fetch stays an effect.
  const [syncedQuery, setSyncedQuery] = useState(searchQuery);
  if (syncedQuery !== searchQuery) {
    setSyncedQuery(searchQuery);
    if (!searchQuery.trim()) setSearchResults([]);
  }

  useEffect(() => {
    if (!searchQuery.trim()) return;
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=athletes`);
        if (res.ok) {
          const data = await res.json();
          const existingIds = new Set(activeParticipants.map(p => p.profile_id));
          setSearchResults((data.results?.athletes || []).filter((p: { id: string }) => !existingIds.has(p.id)));
        } else {
          console.error('Failed to search athletes (group settings) — status:', res.status);
        }
      } catch (e) {
        console.error('Failed to search athletes (group settings):', e);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, activeParticipants]);

  const handleSaveName = async () => {
    if (!name.trim() || name.trim() === conversation.name) return;
    setSavingName(true);
    setError('');
    try {
      const res = await fetch(`/api/messages/${conversation.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim() }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to update');
      }
      onUpdated({ name: name.trim() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update name');
    } finally {
      setSavingName(false);
    }
  };

  const handleRemoveMember = async (participant: ConversationParticipant) => {
    if (!isAdmin) return;
    try {
      const res = await fetch(`/api/messages/${conversation.id}/participants/${participant.profile_id}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to remove');
      }
      onUpdated({
        participants: conversation.participants.map(p =>
          p.profile_id === participant.profile_id
            ? { ...p, left_at: new Date().toISOString() }
            : p
        ),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to remove member');
    }
  };

  const handleAddMember = async (profileId: string) => {
    setAddingMembers(true);
    setError('');
    try {
      const res = await fetch(`/api/messages/${conversation.id}/participants`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileIds: [profileId] }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to add member');
      }
      setSearchQuery('');
      setSearchResults([]);
      // Refresh conversation to get updated participants
      const convRes = await fetch(`/api/messages/${conversation.id}`);
      if (convRes.ok) {
        const d = await convRes.json();
        onUpdated({ participants: d.conversation?.participants });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to add member');
    } finally {
      setAddingMembers(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm('Leave this group conversation?')) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/messages/${conversation.id}/participants/${currentUserId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to leave');
      }
      onLeft();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to leave group');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-md w-full bg-white rounded-xl shadow-xl max-h-modal overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Group Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times"></i>
          </button>
        </div>

        <div className="p-5 space-y-6">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Group Name */}
          {isAdmin && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Group Name</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                  placeholder="Group name"
                  maxLength={100}
                />
                <button
                  onClick={handleSaveName}
                  disabled={savingName || !name.trim() || name.trim() === conversation.name}
                  className="px-4 py-2 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 disabled:opacity-40 transition-colors"
                >
                  {savingName ? <i className="fas fa-spinner fa-spin"></i> : 'Save'}
                </button>
              </div>
            </div>
          )}

          {/* Members */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-3">
              Members ({activeParticipants.length})
            </h3>
            <div className="space-y-2">
              {activeParticipants.map(p => {
                const displayName = formatDisplayName(
                  p.profile?.first_name, null, p.profile?.last_name, p.profile?.full_name
                );
                const isMe = p.profile_id === currentUserId;
                return (
                  <div key={p.id} className="flex items-center gap-3 py-1">
                    {p.profile?.avatar_url ? (
                      <LazyImage
                        src={p.profile.avatar_url}
                        alt={displayName}
                        className="w-9 h-9 rounded-full object-cover shrink-0"
                        width={36}
                        height={36}
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                        {getInitials(displayName)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {displayName} {isMe && <span className="text-gray-400 font-normal">(you)</span>}
                      </p>
                      {p.profile?.handle && (
                        <p className="text-xs text-gray-400 truncate">@{p.profile.handle}</p>
                      )}
                    </div>
                    {p.role === 'admin' && (
                      <span className="text-xs bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full font-medium shrink-0">
                        Admin
                      </span>
                    )}
                    {isAdmin && !isMe && (
                      <button
                        onClick={() => handleRemoveMember(p)}
                        className="text-red-400 hover:text-red-600 p-1 shrink-0"
                        title="Remove from group"
                      >
                        <i className="fas fa-times text-xs"></i>
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Add Members (admin only) */}
          {isAdmin && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Add Members</label>
              <div className="relative">
                <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search athletes…"
                  className="w-full pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                />
              </div>
              {(searching || searchResults.length > 0) && (
                <div className="mt-2 border border-gray-200 rounded-lg overflow-hidden">
                  {searching ? (
                    <div className="px-3 py-3 text-center text-gray-400 text-sm">
                      <i className="fas fa-spinner fa-spin mr-2"></i>Searching…
                    </div>
                  ) : (
                    searchResults.map(result => {
                      const rName = formatDisplayName(result.first_name, null, result.last_name, result.full_name);
                      return (
                        <button
                          key={result.id}
                          onClick={() => handleAddMember(result.id)}
                          disabled={addingMembers}
                          className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 text-left disabled:opacity-50"
                        >
                          {result.avatar_url ? (
                            <LazyImage
                              src={result.avatar_url}
                              alt={rName}
                              className="w-8 h-8 rounded-full object-cover shrink-0"
                              width={32}
                              height={32}
                            />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-violet-500 flex items-center justify-center text-white text-xs font-bold shrink-0">
                              {getInitials(rName)}
                            </div>
                          )}
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-900 truncate">{rName}</p>
                            {result.handle && <p className="text-xs text-gray-400">@{result.handle}</p>}
                          </div>
                          <i className="fas fa-plus text-violet-600 text-xs shrink-0"></i>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )}

          {/* Leave Group */}
          <div className="pt-2 border-t border-gray-200">
            <button
              onClick={handleLeave}
              disabled={saving}
              className="w-full flex items-center justify-center gap-2 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-40"
            >
              <i className="fas fa-sign-out-alt"></i>
              {saving ? 'Leaving…' : 'Leave Group'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
