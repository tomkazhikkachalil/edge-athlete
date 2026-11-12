'use client';

import { useState } from 'react';
import ConfirmModal from '@/components/ConfirmModal';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { gameSheetFor } from '@/lib/videos/game-sheets';
import { COVERAGE_COPY, GAME_COVERAGES, GAME_SIDE_NAME_MAX, gameHasSides, gameTitleLine, type GameCoverage, type GameView } from '@/lib/videos/game-rules';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';
const BTN = 'ea-interactive border border-border-strong text-secondary px-3 min-h-[44px] rounded-lg text-sm font-semibold disabled:opacity-60';

/**
 * The game on a linked video (Sprint 3 PR 2): its sport, the two sides, the
 * day, and whether every scoring play is tagged. A manager makes a video a
 * game here and edits it; a viewer reads one line. Props only — the parent
 * owns the game and is told what was saved.
 */
interface Draft { sport_key: string; played_on: string; side1: string; side2: string; coverage: GameCoverage; stats_hidden: boolean }

const draftOf = (game: GameView | null, sportKey: string | null): Draft => ({
  sport_key: game?.sport_key ?? (gameSheetFor(sportKey) ? (sportKey as string) : ''),
  played_on: game?.played_on ?? '',
  side1: game?.side1.name ?? '',
  side2: game?.side2.name ?? '',
  coverage: game?.coverage ?? 'highlights',
  stats_hidden: game?.stats_hidden ?? true,
});

function dayText(day: string | null): string | null {
  if (!day) return null;
  const d = new Date(`${day}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function GameDetailsCard({ videoId, game, canManage, videoSportKey, onChange }: { videoId: string; game: GameView | null; canManage: boolean; videoSportKey: string | null; onChange: (game: GameView | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => draftOf(game, videoSportKey));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  if (!game && !canManage) return null;

  const open = () => { setDraft(draftOf(game, videoSportKey)); setError(null); setEditing(true); };
  const sides = draft.sport_key ? gameHasSides(draft.sport_key) : false;
  const sideNoun = gameSheetFor(draft.sport_key)?.sideNoun ?? 'Side';

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.sport_key || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/videos/${encodeURIComponent(videoId)}/game`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sport_key: draft.sport_key,
          played_on: draft.played_on || null,
          // A team picked earlier keeps its link while its side is still named; clearing the name clears the side.
          side1: sides ? { name: draft.side1.trim() || null, team_id: draft.side1.trim() ? (game?.side1.team_id ?? null) : null } : null,
          side2: sides ? { name: draft.side2.trim() || null, team_id: draft.side2.trim() ? (game?.side2.team_id ?? null) : null } : null,
          coverage: draft.coverage,
          stats_hidden: draft.stats_hidden,
        }),
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
          <label className="block text-sm text-secondary">
            Sport
            <select className={`${FIELD} mt-1`} value={draft.sport_key} onChange={e => setDraft(d => ({ ...d, sport_key: e.target.value }))} data-video-game-sport="" required>
              <option value="">Choose the sport</option>
              {Object.values(SPORT_REGISTRY).filter(s => s.enabled && gameSheetFor(s.sport_key)).map(s => (
                <option key={s.sport_key} value={s.sport_key}>{s.display_name}</option>
              ))}
            </select>
          </label>
          {sides && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block text-sm text-secondary">
                {sideNoun} 1
                <input className={`${FIELD} mt-1`} maxLength={GAME_SIDE_NAME_MAX} value={draft.side1} onChange={e => setDraft(d => ({ ...d, side1: e.target.value }))} data-video-game-side="1" />
              </label>
              <label className="block text-sm text-secondary">
                {sideNoun} 2
                <input className={`${FIELD} mt-1`} maxLength={GAME_SIDE_NAME_MAX} value={draft.side2} onChange={e => setDraft(d => ({ ...d, side2: e.target.value }))} data-video-game-side="2" />
              </label>
            </div>
          )}
          <label className="block text-sm text-secondary">
            Date played
            <input type="date" className={`${FIELD} mt-1`} value={draft.played_on} onChange={e => setDraft(d => ({ ...d, played_on: e.target.value }))} data-video-game-date="" />
          </label>
          <fieldset className="space-y-1">
            <legend className="text-sm text-secondary">How much is tagged</legend>
            {GAME_COVERAGES.map(c => (
              <label key={c} className="flex items-start gap-2 text-sm text-primary min-h-[44px] py-1">
                <input type="radio" name="game-coverage" value={c} checked={draft.coverage === c} onChange={() => setDraft(d => ({ ...d, coverage: c }))} className="h-4 w-4 mt-1" data-video-game-coverage-option={c} />
                <span><span className="font-semibold">{COVERAGE_COPY[c].label}</span><span className="block text-xs text-muted">{COVERAGE_COPY[c].note}</span></span>
              </label>
            ))}
          </fieldset>
          <label className="flex items-start gap-2 text-sm text-primary min-h-[44px] py-1">
            <input type="checkbox" checked={draft.stats_hidden} onChange={e => setDraft(d => ({ ...d, stats_hidden: e.target.checked }))} className="h-4 w-4 mt-1" data-video-game-hidden="" />
            <span><span className="font-semibold">No spoilers</span><span className="block text-xs text-muted">Viewers see each stat only once the video reaches it, unless they choose to show everything.</span></span>
          </label>
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
