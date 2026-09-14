'use client';

import { useState } from 'react';
import LargerWindow from '@/components/bubbles/LargerWindow';
import LazyImage from '@/components/LazyImage';
import { useProfileSearch } from '@/hooks/useProfileSearch';
import { formatDisplayName } from '@/lib/formatters';

interface Props {
  excludeIds: Set<string>;
  onInvite: (profileId: string) => Promise<boolean>;
  onClose: () => void;
}

/** The organizer's invite window: the house bottom sheet over the public athlete search. */
export default function InviteWindow({ excludeIds, onInvite, onClose }: Props) {
  const search = useProfileSearch({ minChars: 2 });
  const [sent, setSent] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<string | null>(null);

  const invite = async (id: string) => {
    setPending(id);
    const ok = await onInvite(id);
    setPending(null);
    if (ok) setSent(prev => new Set(prev).add(id));
  };

  return (
    <LargerWindow title="Invite players" subtitle="Search by name or handle" onClose={onClose} windowKey="event-invite">
      <div className="space-y-3">
        <input
          type="search"
          value={search.query}
          onChange={e => search.setQuery(e.target.value)}
          onKeyDown={search.onKeyDown}
          placeholder="Name or @handle"
          aria-label="Search athletes"
          autoComplete="off"
          className="w-full min-h-[44px] px-3 rounded-lg border border-border-strong bg-surface text-primary text-base"
          data-event-invite-search=""
        />
        {search.failed && <p className="text-sm text-red-700 dark:text-red-300">Search is unavailable right now.</p>}
        <ul className="divide-y divide-border-subtle">
          {search.results.map(p => {
            const name = formatDisplayName(p.first_name, p.middle_name, p.last_name, p.full_name);
            const already = excludeIds.has(p.id) || sent.has(p.id);
            return (
              <li key={p.id} className="flex items-center gap-3 py-2">
                {p.avatar_url ? (
                  <LazyImage src={p.avatar_url} alt="" width={40} height={40} className="w-10 h-10 rounded-full object-cover shrink-0" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong flex items-center justify-center font-bold shrink-0">{(p.first_name?.[0] ?? p.full_name?.[0] ?? '?').toUpperCase()}</div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-primary truncate">{name}</p>
                  {p.handle && <p className="text-xs text-muted truncate">@{p.handle}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => invite(p.id)}
                  disabled={already || pending === p.id}
                  className="ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60 shrink-0"
                  data-event-invite-row={p.id}
                >
                  {already ? 'Invited' : 'Invite'}
                </button>
              </li>
            );
          })}
        </ul>
        {search.query.length >= 2 && !search.searching && search.results.length === 0 && !search.failed && (
          <p className="text-sm text-muted">No public athletes match. A private athlete can be invited by their exact @handle from the players tab.</p>
        )}
      </div>
    </LargerWindow>
  );
}
