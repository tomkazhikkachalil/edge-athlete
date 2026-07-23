'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { useMessages } from '@/lib/messages';

interface SearchProfile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

interface Props {
  onClose: () => void;
}

type Tab = 'dm' | 'group';

export default function NewConversationModal({ onClose }: Props) {
  const router = useRouter();
  const { fetchConversations } = useMessages();
  const [tab, setTab] = useState<Tab>('dm');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [selectedMembers, setSelectedMembers] = useState<SearchProfile[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const handleSearch = useCallback(async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=athletes`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data.results?.athletes || []);
      } else {
        console.error('Failed to search athletes (new conversation) — status:', res.status);
      }
    } catch (e) {
      console.error('Failed to search athletes (new conversation):', e);
    } finally {
      setSearching(false);
    }
  }, []);

  const handleSelectDM = async (profile: SearchProfile) => {
    if (creating) return;
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'direct', participantId: profile.id }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create conversation');
      }
      const d = await res.json();
      await fetchConversations();
      onClose();
      router.push(`/messages?c=${d.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create conversation');
    } finally {
      setCreating(false);
    }
  };

  const handleToggleMember = (profile: SearchProfile) => {
    setSelectedMembers(prev => {
      const exists = prev.some(p => p.id === profile.id);
      if (exists) return prev.filter(p => p.id !== profile.id);
      return [...prev, profile];
    });
  };

  const handleCreateGroup = async () => {
    if (!groupName.trim()) { setError('Group name is required'); return; }
    if (selectedMembers.length < 2) { setError('Add at least 2 members'); return; }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'group',
          name: groupName.trim(),
          participantIds: selectedMembers.map(m => m.id),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.error || 'Failed to create group');
      }
      const d = await res.json();
      await fetchConversations();
      onClose();
      router.push(`/messages?c=${d.conversationId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create group');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="max-w-md w-full bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <h2 className="text-lg font-bold text-gray-900">New Message</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 p-1">
            <i className="fas fa-times"></i>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 shrink-0">
          <button
            onClick={() => { setTab('dm'); setSearchQuery(''); setSearchResults([]); setError(''); }}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'dm' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fas fa-user mr-2"></i>Direct Message
          </button>
          <button
            onClick={() => { setTab('group'); setSearchQuery(''); setSearchResults([]); setError(''); }}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === 'group' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <i className="fas fa-users mr-2"></i>Group Chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Group Name (group tab only) */}
          {tab === 'group' && (
            <input
              type="text"
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              placeholder="Group name…"
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              maxLength={100}
            />
          )}

          {/* Selected members chips (group tab) */}
          {tab === 'group' && selectedMembers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedMembers.map(m => {
                const mName = formatDisplayName(m.first_name, null, m.last_name, m.full_name);
                return (
                  <span
                    key={m.id}
                    className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-700 text-xs font-medium rounded-full px-3 py-1"
                  >
                    {mName}
                    <button onClick={() => handleToggleMember(m)} className="hover:text-blue-900">
                      <i className="fas fa-times text-xs"></i>
                    </button>
                  </span>
                );
              })}
            </div>
          )}

          {/* Search */}
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-xs"></i>
            <input
              type="text"
              value={searchQuery}
              onChange={e => handleSearch(e.target.value)}
              placeholder="Search athletes…"
              className="w-full pl-8 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
          </div>

          {/* Results */}
          {searching ? (
            <div className="text-center py-4 text-gray-400 text-sm">
              <i className="fas fa-spinner fa-spin mr-2"></i>Searching…
            </div>
          ) : searchResults.length > 0 ? (
            <div className="space-y-1">
              {searchResults.map(result => {
                const rName = formatDisplayName(result.first_name, null, result.last_name, result.full_name);
                const isSelected = selectedMembers.some(m => m.id === result.id);
                return (
                  <button
                    key={result.id}
                    onClick={() => tab === 'dm' ? handleSelectDM(result) : handleToggleMember(result)}
                    disabled={creating}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors disabled:opacity-50 ${
                      isSelected ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    {result.avatar_url ? (
                      <LazyImage
                        src={result.avatar_url}
                        alt={rName}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                        width={40}
                        height={40}
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white text-sm font-bold shrink-0">
                        {getInitials(rName)}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{rName}</p>
                      {result.handle && <p className="text-xs text-gray-400">@{result.handle}</p>}
                    </div>
                    {tab === 'group' && (
                      <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                        isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
                      }`}>
                        {isSelected && <i className="fas fa-check text-white text-xs"></i>}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          ) : searchQuery && !searching ? (
            <div className="text-center py-4 text-gray-400 text-sm">No athletes found</div>
          ) : null}
        </div>

        {/* Footer (group tab only) */}
        {tab === 'group' && (
          <div className="px-4 py-3 border-t border-gray-200 shrink-0">
            <button
              onClick={handleCreateGroup}
              disabled={creating || !groupName.trim() || selectedMembers.length < 2}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              {creating ? (
                <><i className="fas fa-spinner fa-spin mr-2"></i>Creating…</>
              ) : (
                `Create Group (${selectedMembers.length} members)`
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
