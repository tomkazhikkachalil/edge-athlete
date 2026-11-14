'use client';

import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { gameSheetFor } from '@/lib/videos/game-sheets';
import { COVERAGE_COPY, GAME_COVERAGES, GAME_SIDE_NAME_MAX, gameHasSides } from '@/lib/videos/game-rules';
import { pickSideTeam, typeSideName, type GameDraft, type TeamOption } from '@/lib/videos/game-draft';

const FIELD = 'w-full border border-border-strong rounded-lg px-3 min-h-[44px] text-base bg-surface text-primary';

/**
 * The game's fields (round 2, Nov 13 2026): the sport, the two sides, the
 * day, how much is tagged, no spoilers. ONE field set for the video page's
 * card and the Details step of the Full game flow. Controlled — the parent
 * owns the draft and the save. `teams` (a club's or league's own) lets a
 * side be one of them; without it a side is a typed name.
 */
export default function GameFields({ value, onChange, teams, name = 'game' }: { value: GameDraft; onChange: (next: GameDraft) => void; teams?: readonly TeamOption[]; name?: string }) {
  const sides = value.sport_key ? gameHasSides(value.sport_key) : false;
  const sideNoun = gameSheetFor(value.sport_key)?.sideNoun ?? 'Side';
  const side = (n: 1 | 2) => {
    const text = n === 1 ? value.side1 : value.side2;
    const teamId = n === 1 ? value.side1_team_id : value.side2_team_id;
    return (
      <div className="space-y-2">
        <label className="block text-sm text-secondary">
          {sideNoun} {n}
          <input className={`${FIELD} mt-1`} maxLength={GAME_SIDE_NAME_MAX} value={text} onChange={e => onChange(typeSideName(value, n, e.target.value))} data-video-game-side={n} />
        </label>
        {teams && teams.length > 0 && (
          <label className="block text-xs text-muted">
            One of your teams (optional)
            <select
              className={`${FIELD} mt-1`}
              value={teamId && teams.some(t => t.id === teamId) ? teamId : ''}
              onChange={e => onChange(pickSideTeam(value, n, teams.find(t => t.id === e.target.value) ?? null))}
              data-video-game-team={n}
            >
              <option value="">Not one of your teams</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>
    );
  };
  return (
    <div className="space-y-3" data-video-game-fields="">
      <label className="block text-sm text-secondary">
        Sport
        <select className={`${FIELD} mt-1`} value={value.sport_key} onChange={e => onChange({ ...value, sport_key: e.target.value })} data-video-game-sport="" required>
          <option value="">Choose the sport</option>
          {Object.values(SPORT_REGISTRY).filter(s => s.enabled && gameSheetFor(s.sport_key)).map(s => (
            <option key={s.sport_key} value={s.sport_key}>{s.display_name}</option>
          ))}
        </select>
      </label>
      {sides && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {side(1)}
          {side(2)}
        </div>
      )}
      <label className="block text-sm text-secondary">
        Date played
        <input type="date" className={`${FIELD} mt-1`} value={value.played_on} onChange={e => onChange({ ...value, played_on: e.target.value })} data-video-game-date="" />
      </label>
      <fieldset className="space-y-1">
        <legend className="text-sm text-secondary">How much is tagged</legend>
        {GAME_COVERAGES.map(c => (
          <label key={c} className="flex items-start gap-2 text-sm text-primary min-h-[44px] py-1">
            <input type="radio" name={`${name}-coverage`} value={c} checked={value.coverage === c} onChange={() => onChange({ ...value, coverage: c })} className="h-4 w-4 mt-1" data-video-game-coverage-option={c} />
            <span><span className="font-semibold">{COVERAGE_COPY[c].label}</span><span className="block text-xs text-muted">{COVERAGE_COPY[c].note}</span></span>
          </label>
        ))}
      </fieldset>
      <label className="flex items-start gap-2 text-sm text-primary min-h-[44px] py-1">
        <input type="checkbox" checked={value.stats_hidden} onChange={e => onChange({ ...value, stats_hidden: e.target.checked })} className="h-4 w-4 mt-1" data-video-game-hidden="" />
        <span><span className="font-semibold">No spoilers</span><span className="block text-xs text-muted">Viewers see each stat only once the video reaches it, unless they choose to show everything.</span></span>
      </label>
    </div>
  );
}
