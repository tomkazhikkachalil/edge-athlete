'use client';

import { useEffect, useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import GameFields from '@/components/videos/GameFields';
import { ORG_ROUTE_FAMILY } from '@/lib/orgs/org-ref';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { gameBodyOf, gameDraftOf, type GameDraft, type TeamOption } from '@/lib/videos/game-draft';
import { COVERAGE_COPY, gameTitleLine, type GameView } from '@/lib/videos/game-rules';
import type { VideoOwnerView } from '@/lib/videos/types';

const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The game on a linked video (Sprint 3 PR 2): its sport, the two sides, the
 * day, and whether every scoring play is tagged. A manager makes a video a
 * game here and edits it; a viewer reads one line. Props only — the parent
 * owns the game and is told what was saved. The fields are `GameFields`
 * (shared with the Full game flow); on a club's or league's own video a
 * side can be one of its teams.
 */
function dayText(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GameDetailsCard({ videoId, game, canManage, videoSportKey, owner, onChange }: { videoId: string; game: GameView | null; canManage: boolean; videoSportKey: string | null; owner?: VideoOwnerView; onChange: (game: GameView | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<GameDraft>(() => gameDraftOf(game, videoSportKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const [teams, setTeams] = useState<TeamOption[]>([]);
  // A club's or league's own video: its teams, read once the form opens (a refusal simply leaves the sides as typed names).
  const orgPath = owner?.kind === 'org' ? `/api/${ORG_ROUTE_FAMILY[owner.side]}/${encodeURIComponent(owner.id)}/teams` : null;
  useEffect(() => {
    if (!editing || !orgPath) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(orgPath, { cache: 'no-store' });
        if (!res.ok) return;
        const body = (await res.json()) as { teams?: Array<{ id: string; name: string }> };
        if (!cancelled) setTeams((body.teams ?? []).map(t => ({ id: t.id, name: t.name })));
      } catch {
        /* the sides stay typed names */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, orgPath]);

  if (!game && !canManage) return null;

  const open = () => { setDraft(gameDraftOf(game, videoSportKey)); setError(null); setEditing(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.sport_key || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/game`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gameBodyOf(draft)),
      });
      const body = (await res.json().catch(() => ({}))) as { game?: GameView; error?: string };
      if (!res.ok || !body.game) { setError(body.error ?? 'Could not save the game.'); return; }
      onChange(body.game);
      setEditing(false);
    } catch {
      setError('Could not save the game. Check your connection and try again.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setConfirmRemove(false);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/game`, { method: 'DELETE' });
      if (!res.ok) { setError('Could not remove the game details.'); return; }
      onChange(null);
      setEditing(false);
    } catch {
      setError('Could not remove the game details. Check your connection and try again.');
    }
  };

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-3" data-video-game={game ? game.sport_key : 'none'}>
      {!editing && game && (
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-lg font-bold text-primary break-words" data-video-game-title="">{gameTitleLine(game)}</p>
            <p className="text-sm text-secondary">
              {[SPORT_REGISTRY[game.sport_key as keyof typeof SPORT_REGISTRY]?.display_name, dayText(game.played_on)].filter(Boolean).join(' · ')}
            </p>
            {canManage && <p className="text-xs text-muted mt-1" data-video-game-coverage={game.coverage}>{COVERAGE_COPY[game.coverage].label}{game.stats_hidden ? ' · stats hidden until the video reaches them' : ''}</p>}
          </div>
          {canManage && <button type="button" onClick={open} className={BTN} data-video-game-edit="">Edit</button>}
        </div>
      )}
      {!editing && !game && canManage && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-primary">Is this a game?</p>
          <p className="text-sm text-secondary">Say the sport, who played and when. Highlights can then be tagged with what happened and who was in them, and the stats build themselves from the tags.</p>
          <button type="button" onClick={open} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white" data-video-game-start="">Add game details</button>
        </div>
      )}
      {editing && (
        <form onSubmit={save} className="space-y-3" data-video-game-form="">
          <GameFields value={draft} onChange={setDraft} teams={teams} name={`game-${videoId}`} />
          {error && <p className="text-sm text-red-600" role="alert" data-video-game-error="">{error}</p>}
          <div className="flex flex-wrap gap-2 justify-end">
            {game && <button type="button" onClick={() => setConfirmRemove(true)} className={`${BTN} mr-auto`} data-video-game-remove="">Remove game details</button>}
            <button type="button" onClick={() => setEditing(false)} className={BTN}>Cancel</button>
            <button type="submit" disabled={saving || !draft.sport_key} className="ea-cta px-4 min-h-[44px] rounded-lg text-sm font-semibold text-white disabled:opacity-60" data-video-game-save="">{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      )}
      {!editing && error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <ConfirmModal
        isOpen={confirmRemove}
        title="Remove the game details?"
        message="The sport, the sides and the date are removed, and the score and stats built from the tags stop showing. The video and its highlights stay."
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onCancel={() => setConfirmRemove(false)}
        onConfirm={remove}
      />
    </div>
  );
}
