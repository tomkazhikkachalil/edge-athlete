'use client';

import { useState } from 'react';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { useProfileSearch, type SearchProfile } from '@/hooks/useProfileSearch';
import {
  GROUP_NAME_MAX,
  buildGroupCreateBody,
  canCreateGroup,
  groupDraftError,
  toggleGroupMember,
} from '@/components/messages/group-draft';

// Start a GROUP chat without leaving the dock. The board's NewConversationModal
// cannot be reused here — it is a 448px fixed-inset card that sits above the
// dock's z-band and redirects to /messages on success — so the shared piece is
// the RULES (group-draft) and the API contract, which is what makes the two
// surfaces behave the same.
//
// The draft ({ name, members }) is owned by DockPanel, not by this component:
// collapsing the pill or bouncing to the direct composer must not lose typing.
// That is also why there is no discard confirm — the dock's convention is a
// bare Cancel (see DockComposer), and a full-screen z-[60] ConfirmModal over a
// 320px pill would be worse than the loss it prevents. Nothing is discarded,
// so there is nothing to confirm.

export interface GroupDraft {
  name: string;
  members: SearchProfile[];
}

export const EMPTY_GROUP_DRAFT: GroupDraft = { name: '', members: [] };

export default function DockGroupComposer({
  currentUserId,
  draft,
  onDraftChange,
  onOpened,
  onCancel,
}: {
  currentUserId: string;
  draft: GroupDraft;
  onDraftChange: (draft: GroupDraft) => void;
  onOpened: (conversationId: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { query, setQuery, results, searching } = useProfileSearch({ excludeId: currentUserId });
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  const { name, members } = draft;
  const canCreate = canCreateGroup({ name, members, creating });

  const toggle = (profile: SearchProfile) => {
    onDraftChange({ ...draft, members: toggleGroupMember(members, profile) });
  };

  const create = async () => {
    // Guarded twice on purpose: group creation has NO server-side dedupe, so a
    // double submit makes two rooms.
    if (creating) return;
    const invalid = groupDraftError(name, members);
    if (invalid) {
      setError(invalid);
      return;
    }
    setCreating(true);
    setError('');
    try {
      const res = await fetch('/api/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildGroupCreateBody(name, members)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not create the group.');
        return;
      }
      onDraftChange(EMPTY_GROUP_DRAFT);
      await onOpened(data.conversationId);
    } catch {
      setError('Could not create the group.');
    } finally {
      // Always clears, so a 403 (a member not accepting messages) leaves the
      // composer usable rather than stuck.
      setCreating(false);
    }
  };

  return (
    // min-h-0 on the column AND the results list: the dock body is a fixed
    // height with overflow-hidden, so without it the footer button is silently
    // clipped out of existence once the list has content.
    <div className="flex flex-col flex-1 min-h-0">
      <div className="px-3 py-2 border-b border-border-subtle flex items-center gap-2 shrink-0">
        <input
          type="text"
          autoFocus
          value={name}
          onChange={e => onDraftChange({ ...draft, name: e.target.value })}
          placeholder="Group name…"
          maxLength={GROUP_NAME_MAX}
          aria-label="Group name"
          className="flex-1 min-w-0 px-3 py-1.5 bg-surface-muted border border-border rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-muted hover:text-secondary shrink-0"
        >
          Cancel
        </button>
      </div>

      {/* Chips scroll HORIZONTALLY (the same idiom as the panel's "Active now"
          strip) rather than wrapping like the board's modal. Wrapping is
          unbounded and would eat a 384px panel; this costs a fixed ~34px no
          matter how many members are selected, and the count in the footer
          button means nothing is hidden. */}
      {members.length > 0 && (
        <div className="px-3 py-1.5 border-b border-border-subtle shrink-0">
          <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
            {members.map(m => {
              const mName = formatDisplayName(m.first_name, null, m.last_name, m.full_name);
              return (
                <span
                  key={m.id}
                  className="shrink-0 flex items-center gap-1 bg-violet-100 text-brand-fg-strong rounded-full pl-2 pr-1 py-0.5 text-xs"
                >
                  <span className="max-w-[7rem] truncate">{mName}</span>
                  <button
                    type="button"
                    onClick={() => toggle(m)}
                    aria-label={`Remove ${mName}`}
                    className="w-4 h-4 flex items-center justify-center rounded-full hover:bg-violet-200"
                  >
                    <i className="fas fa-xmark text-[10px]"></i>
                  </button>
                </span>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-3 py-2 border-b border-border-subtle shrink-0">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Add people…"
          aria-label="Search people to add"
          className="w-full px-3 py-1.5 bg-surface-muted border border-border rounded-full text-sm focus:outline-none focus:ring-1 focus:ring-violet-500"
        />
      </div>

      {error && (
        <p role="alert" className="px-3 py-2 text-xs text-red-600 shrink-0">
          {error}
        </p>
      )}

      <div className="flex-1 overflow-y-auto min-h-0">
        {searching && results.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">Searching…</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-faint text-center py-6">
            {query.trim().length < 2 ? 'Search for people to add.' : 'No one found.'}
          </p>
        ) : (
          results.map(profile => {
            const pName = formatDisplayName(
              profile.first_name,
              null,
              profile.last_name,
              profile.full_name
            );
            const selected = members.some(m => m.id === profile.id);
            return (
              <button
                key={profile.id}
                type="button"
                onClick={() => toggle(profile)}
                aria-pressed={selected}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-brand-soft"
              >
                <span className="w-8 h-8 rounded-full overflow-hidden bg-violet-100 shrink-0">
                  {profile.avatar_url ? (
                    <LazyImage
                      src={profile.avatar_url}
                      alt={pName}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="w-full h-full flex items-center justify-center text-xs font-semibold text-brand-fg-strong">
                      {getInitials(pName)}
                    </span>
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm text-primary truncate">{pName}</span>
                  {profile.handle && (
                    <span className="block text-xs text-muted truncate">@{profile.handle}</span>
                  )}
                </span>
                <span
                  className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 ${
                    selected ? 'bg-brand border-brand text-white' : 'border-border-strong'
                  }`}
                  aria-hidden="true"
                >
                  {selected && <i className="fas fa-check text-[10px]"></i>}
                </span>
              </button>
            );
          })
        )}
      </div>

      <div className="px-3 py-2 border-t border-border-subtle shrink-0">
        <button
          type="button"
          onClick={create}
          disabled={!canCreate}
          className="w-full py-2 bg-brand text-white rounded-lg text-sm font-semibold hover:bg-brand-hover disabled:opacity-40 transition-colors"
        >
          {creating ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2"></i>Creating…
            </>
          ) : (
            `Create group (${members.length})`
          )}
        </button>
      </div>
    </div>
  );
}
