'use client';

import { useCallback, useEffect, useState } from 'react';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';
import { formatDisplayName, getInitials } from '@/lib/formatters';

// ── Blocked users (Round I) ───────────────────────────────────────────────────
// The first block-list surface in the app: until now blocking existed only as
// a chat action with no way to see or reverse it. Renders in Settings →
// Messaging for everyone, and on the guardian console athlete page with
// `profileId` set (guardian manages the CHILD's list; every call carries
// targetProfileId and the server re-checks the role).

interface BlockedProfile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

interface BlockRow {
  /** Absent in household scope (rows are grouped per blocked person). */
  id?: string;
  created_at: string;
  blocked: BlockedProfile;
  /** Household scope: true = every household member blocks this person. */
  full?: boolean;
}

interface SearchPerson {
  id: string;
  first_name?: string | null;
  middle_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
  handle?: string | null;
}

function personName(p: BlockedProfile | SearchPerson): string {
  return formatDisplayName(
    p.first_name ?? null, p.middle_name ?? null, p.last_name ?? null, p.full_name ?? null
  );
}

function Avatar({ src, name }: { src: string | null | undefined; name: string }) {
  return (
    <div className="relative w-9 h-9 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
      {src ? (
        <Image
          src={src}
          alt=""
          fill
          sizes="36px"
          className="object-cover"
          unoptimized={!isOptimizableImageSrc(src)}
        />
      ) : (
        <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(name)}</span>
      )}
    </div>
  );
}

export default function BlockedUsersList({
  profileId,
  canAdd = false,
  subjectName,
  scope = 'self',
}: {
  /** Set = a guardian managing this managed athlete's list. Unset = self. */
  profileId?: string;
  /** Show the search-and-block form (console use). */
  canAdd?: boolean;
  /** Whose list this is, for copy ("Emma" / undefined = "you"). */
  subjectName?: string;
  /** 'household' (Wave 4) switches every call to /api/guardian/blocks —
   *  one action covers the guardian and every supervised athlete. */
  scope?: 'self' | 'household';
}) {
  const { showSuccess, showError } = useToast();
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [unblockTarget, setUnblockTarget] = useState<BlockRow | null>(null);
  const [busy, setBusy] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchPerson[]>([]);
  const [searching, setSearching] = useState(false);

  const household = scope === 'household';
  const target = profileId ? `?profileId=${profileId}` : '';
  const targetBody = profileId ? { targetProfileId: profileId } : {};
  const listUrl = household ? '/api/guardian/blocks' : `/api/messages/block${target}`;

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(listUrl);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setBlocks(data.blocks ?? []);
    } catch {
      // informational — never break the surface
    } finally {
      setLoaded(true);
    }
  }, [listUrl]);

  useEffect(() => {
    // Async hop (house pattern) — no synchronous setState on the effect path.
    (async () => {
      await refetch();
    })();
  }, [refetch]);

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true);
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query.trim())}&type=athletes`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Search failed');
      const blockedIds = new Set(blocks.map(b => b.blocked?.id));
      setResults(
        ((data.results?.athletes ?? []) as SearchPerson[])
          .filter(p => p.id !== profileId && !blockedIds.has(p.id))
          .slice(0, 5)
      );
    } catch (err) {
      showError('Search failed', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setSearching(false);
    }
  };

  const block = async (person: SearchPerson) => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(household ? '/api/guardian/blocks' : '/api/messages/block', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(household ? { blockedId: person.id } : { blockedId: person.id, ...targetBody }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not block this user');
      showSuccess('Blocked', `${personName(person)} can no longer message ${subjectName || 'you'}.`);
      setResults(r => r.filter(p => p.id !== person.id));
      refetch();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  const unblock = async () => {
    if (!unblockTarget || busy) return;
    setBusy(true);
    try {
      const params = new URLSearchParams({ blockedId: unblockTarget.blocked.id });
      if (!household && profileId) params.set('targetProfileId', profileId);
      const res = await fetch(
        household ? `/api/guardian/blocks?${params}` : `/api/messages/block?${params}`,
        { method: 'DELETE' }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not unblock this user');
      showSuccess('Unblocked');
      setUnblockTarget(null);
      refetch();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      {canAdd && (
        <form onSubmit={runSearch} className="flex gap-2 mb-3">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search people to block…"
            aria-label="Search people to block"
            className="flex-1 min-w-0 px-3 py-2 min-h-[44px] border border-border-strong rounded-lg text-sm text-primary bg-surface"
          />
          <button
            type="submit"
            disabled={searching || !query.trim()}
            className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50 shrink-0"
          >
            {searching ? <i className="fas fa-spinner fa-spin"></i> : 'Search'}
          </button>
        </form>
      )}

      {results.length > 0 && (
        <ul className="space-y-2 mb-4">
          {results.map(person => {
            const name = personName(person);
            return (
              <li key={person.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                <Avatar src={person.avatar_url} name={name} />
                <div className="flex-grow min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{name}</p>
                  {person.handle && <p className="text-xs text-muted truncate">@{person.handle}</p>}
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => block(person)}
                  className="px-3 py-2 min-h-[44px] inline-flex items-center border border-red-300 dark:border-red-800 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors disabled:opacity-50 shrink-0"
                >
                  Block
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {!loaded ? (
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand my-4"></div>
      ) : blocks.length === 0 ? (
        <p className="text-sm text-muted">
          {subjectName ? `${subjectName} hasn't blocked anyone.` : "You haven't blocked anyone."}
        </p>
      ) : (
        <ul className="space-y-2">
          {blocks.map(row => {
            const name = personName(row.blocked);
            return (
              <li key={row.id ?? row.blocked.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                <Avatar src={row.blocked.avatar_url} name={name} />
                <div className="flex-grow min-w-0">
                  <p className="text-sm font-medium text-primary truncate">{name}</p>
                  {row.blocked.handle && (
                    <p className="text-xs text-muted truncate">@{row.blocked.handle}</p>
                  )}
                  {household && row.full === false && (
                    <p className="text-[11px] text-amber-700 dark:text-amber-300">
                      Blocked by part of the household — Block again to cover everyone.
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setUnblockTarget(row)}
                  className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors shrink-0"
                >
                  Unblock
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmModal
        isOpen={!!unblockTarget}
        title="Unblock this user?"
        message={`${unblockTarget ? personName(unblockTarget.blocked) : ''} will be able to send ${subjectName || 'you'} messages again (subject to the messaging settings).`}
        confirmText={busy ? 'Unblocking…' : 'Unblock'}
        onConfirm={unblock}
        onCancel={() => setUnblockTarget(null)}
      />
    </div>
  );
}
