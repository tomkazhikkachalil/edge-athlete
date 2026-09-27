'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import { filterCandidates, type RosterCandidate } from '@/lib/teams/roster-view';

// ── One team's roster in the console (teams & divisions program, PR 5) ──────
// Who is on the team NOW (the current season — PR 4's one reader), and the
// three things a manager does: ADD a member who is on the org's roster, MOVE
// a player to another team, REMOVE a player (confirmed — their past results
// stay). A member who is not on the org roster yet gets "Invite to roster":
// the existing roster offer, which a minor's guardian approves (convention
// 10) — the add opens once they accept. Every write goes through
// /api/{plural}/{orgId}/teams/{teamId}/roster; refusals show the server's
// own words.
//
// 375px: one column, 44px targets, the filter full width.

interface RosterPlayer {
  profileId: string;
  name: string;
  supervised: boolean;
}

interface Props {
  side: OrgKind;
  orgId: string;
  team: { id: string; name: string };
  /** The org's other ACTIVE teams — the move targets. */
  otherTeams: { id: string; name: string }[];
  onSuccess: (message: string) => void;
  onError: (message: string) => void;
  /** A move changes the other team's roster too — the section re-reads. */
  onMoved: () => void;
}

export default function TeamRosterPanel({ side, orgId, team, otherTeams, onSuccess, onError, onMoved }: Props) {
  const plural = ORG_ROUTE_FAMILY[side];
  const url = `/api/${plural}/${orgId}/teams/${team.id}/roster`;
  const [roster, setRoster] = useState<RosterPlayer[] | null>(null);
  const [candidates, setCandidates] = useState<RosterCandidate[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState<Record<string, string>>({});
  const [invited, setInvited] = useState<Set<string>>(new Set());
  const [confirmRemove, setConfirmRemove] = useState<RosterPlayer | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  // The load reports through a ref — a parent's fresh callback each render
  // must never re-run the fetch.
  const onErrorRef = useRef(onError);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${url}?candidates=1`, { cache: 'no-store' });
        const body = (await res.json().catch(() => ({}))) as { roster?: RosterPlayer[]; candidates?: RosterCandidate[]; error?: string };
        if (cancelled) return;
        if (!res.ok) {
          onErrorRef.current(body.error || 'Could not load the roster');
          setRoster([]);
          return;
        }
        setRoster(body.roster ?? []);
        setCandidates(body.candidates ?? []);
      } catch {
        if (!cancelled) {
          onErrorRef.current('Could not load the roster');
          setRoster([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, reloadKey]);

  const write = useCallback(
    async (key: string, init: RequestInit, done: string, path = url): Promise<boolean> => {
      setBusy(key);
      try {
        const res = await fetch(path, { ...init, headers: { 'Content-Type': 'application/json' } });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) {
          onError(body.error || 'Could not update the roster');
          return false;
        }
        onSuccess(done);
        setReloadKey(k => k + 1);
        return true;
      } catch {
        onError('Could not update the roster');
        return false;
      } finally {
        setBusy(null);
      }
    },
    [url, onError, onSuccess]
  );

  const { canAdd, needsInvite } = filterCandidates(candidates, query);
  const small = 'min-h-[44px] px-3 text-sm rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50';

  return (
    <div className="w-full mt-2 border-t border-border-subtle pt-3 space-y-4" data-team-roster={team.id}>
      <div>
        <p className="text-sm font-medium text-primary mb-2">On {team.name}</p>
        {roster === null ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : roster.length === 0 ? (
          <p className="text-sm text-tertiary">No one on this team yet.</p>
        ) : (
          <ul className="space-y-2">
            {roster.map(p => (
              <li key={p.profileId} className="rounded-lg border border-border p-2" data-team-roster-player={p.profileId}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="min-w-0 text-sm text-primary">
                    <span className="font-medium">{p.name}</span>
                    {p.supervised && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-secondary">Minor</span>}
                  </span>
                  <button type="button" disabled={busy !== null} onClick={() => setConfirmRemove(p)} className={small} aria-label={`Remove ${p.name} from ${team.name}`}>
                    Remove
                  </button>
                </div>
                {otherTeams.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={moveTo[p.profileId] ?? ''}
                      onChange={e => setMoveTo(m => ({ ...m, [p.profileId]: e.target.value }))}
                      aria-label={`Move ${p.name} to`}
                      className="grow basis-40 min-w-0 min-h-[44px] px-3 border border-border-strong rounded-md text-sm"
                    >
                      <option value="">Move to…</option>
                      {otherTeams.map(t => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={busy !== null || !moveTo[p.profileId]}
                      onClick={async () => {
                        const target = otherTeams.find(t => t.id === moveTo[p.profileId]);
                        if (!target) return;
                        const ok = await write(`move:${p.profileId}`, { method: 'PATCH', body: JSON.stringify({ profileId: p.profileId, toTeamId: target.id }) }, `${p.name} moved to ${target.name}`);
                        if (ok) onMoved();
                      }}
                      className={small}
                    >
                      Move
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div>
        <label htmlFor={`team-add-${team.id}`} className="block text-sm font-medium text-primary mb-2">
          Add a member
        </label>
        <input
          id={`team-add-${team.id}`}
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Type a name"
          className="w-full min-h-[44px] px-3 border border-border-strong rounded-md text-sm"
        />
        <ul className="mt-2 space-y-1.5" data-team-roster-candidates="">
          {canAdd.map(c => (
            <li key={c.profileId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-2 hover:bg-surface-muted">
              <span className="min-w-0 text-sm text-primary">{c.name}</span>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void write(`add:${c.profileId}`, { method: 'POST', body: JSON.stringify({ profileId: c.profileId }) }, `${c.name} added to ${team.name}`)}
                className={small}
                aria-label={`Add ${c.name} to ${team.name}`}
              >
                Add
              </button>
            </li>
          ))}
          {needsInvite.map(c => (
            <li key={c.profileId} className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-2" data-team-roster-needs-invite={c.profileId}>
              <span className="min-w-0 text-sm">
                <span className="text-primary">{c.name}</span>
                <span className="block text-xs text-muted">
                  {invited.has(c.profileId)
                    ? c.supervised
                      ? 'Invited — their guardian approves, then you can add them.'
                      : 'Invited — you can add them once they accept.'
                    : 'Not on your roster yet'}
                </span>
              </span>
              {!invited.has(c.profileId) && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={async () => {
                    const ok = await write(
                      `invite:${c.profileId}`,
                      { method: 'POST' },
                      `${c.name} invited to your roster`,
                      `/api/${plural}/${orgId}/roster?profileId=${encodeURIComponent(c.profileId)}`
                    );
                    if (ok) setInvited(s => new Set(s).add(c.profileId));
                  }}
                  className={small}
                >
                  Invite to roster
                </button>
              )}
            </li>
          ))}
          {canAdd.length === 0 && needsInvite.length === 0 && (
            <li className="text-sm text-tertiary">{query.trim() ? 'No member matches that name.' : candidates.length === 0 ? 'No other members to add yet.' : ''}</li>
          )}
        </ul>
      </div>

      <ConfirmModal
        isOpen={!!confirmRemove}
        title={confirmRemove ? `Take ${confirmRemove.name} off ${team.name}?` : ''}
        message="Past results stay on the record. They stay on your roster and can be added back."
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const p = confirmRemove;
          setConfirmRemove(null);
          if (p) void write(`remove:${p.profileId}`, { method: 'DELETE', body: JSON.stringify({ profileId: p.profileId }) }, `${p.name} taken off ${team.name}`);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
    </div>
  );
}
