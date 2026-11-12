/**
 * The game sheets (Sprint 3 — YouTube game film, Nov 12 2026) — pure, zero
 * imports. One declarative sheet per sport says what can be TAGGED on a
 * full-game video (the event types), who takes part in each (the roles),
 * what each tag adds to a player's line and to the team's, and what counts
 * toward the score. Every stat of a tagged game is DERIVED from the tags
 * (game-derive.ts) — there is no second place a number is typed.
 *
 * The baselines are the box scores the broadcasters print (ESPN, theScore,
 * TSN, Sportsnet): the columns here are theirs, cut to what a person
 * tagging a video can reasonably mark. Stat keys are the sport's own
 * stat-schema keys (stat-schemas.ts) wherever one exists, so a tagged game
 * reads the same as a typed stat line; a key the schema does not have is
 * declared in `extra` with its label (pinned by game-sheets.test.ts).
 *
 * Four families share one engine:
 *   team   — two sides, a score, a box score, a scoring summary
 *   combat — two fighters, rounds, points where the sport scores them, a finish
 *   race   — any number of athletes, results by time / mark / place
 *   golf   — a scorecard by hole
 */

export type SheetFamily = 'team' | 'combat' | 'race' | 'golf';
export type Side = 1 | 2;
export type StatDelta = Readonly<Record<string, number>>;

export interface SheetRole {
  key: string;
  label: string;
  /** How many people may hold the role on one tag (hockey: two assists). Default 1. */
  max?: number;
  /** What ONE person in the role gains. `'value'` as a number means "the tag's value" (a penalty's minutes, near-fall points). */
  stats: Readonly<Record<string, number | 'value'>>;
  /** The person is on the OTHER side from the tag's side (the goalie beaten by a goal). */
  other?: boolean;
  /** The role's stats count for the side even when nobody is named (the first role of an event, unless said otherwise). */
  primary?: boolean;
}

export type EventGroup = 'score' | 'attack' | 'defence' | 'discipline' | 'result' | 'marker';

export interface SheetEvent {
  key: string;
  label: string;
  /** The two-to-four letters a timeline chip shows. */
  short: string;
  group: EventGroup;
  /** Points the tag puts on the board: to the tag's side or the other one. `'value'` = the tag's value. */
  score?: { points: number | 'value'; to: 'own' | 'other' };
  roles: readonly SheetRole[];
  /** Added to the tag's side as a team-only number (corners, offsides). */
  team?: StatDelta;
  /** The tag carries a number, and what it is. */
  takesValue?: { kind: 'points' | 'minutes' | 'time_ms' | 'mark' | 'strokes' | 'place'; label: string; min: number; max: number; default?: number };
  /** Combat: this tag ends the bout for the tag's side (the winner) by this method. */
  finish?: string;
}

export interface SheetColumn {
  label: string;
  /** One stat key, or made–attempted ("6-11"). */
  key: string | readonly [made: string, attempted: string];
}

export interface GameSheet {
  sportKey: string;
  family: SheetFamily;
  /** The noun for the two sides: "Team" or "Fighter". */
  sideNoun: string;
  period: { noun: string; short: string; regulation: number; extra?: string };
  /** `sets`: a period is a set — the board shows sets won, with the points of each (volleyball, tennis). */
  scoreMode: 'total' | 'sets' | 'none';
  /** Points that win a set, by set number (volleyball: 25, the fifth to 15); win by two. */
  setTarget?: (set: number) => number;
  events: readonly SheetEvent[];
  /** The player box score, in the broadcasters' order. */
  box: readonly SheetColumn[];
  /** The team comparison rows. */
  team: readonly SheetColumn[];
  /** Labels of stat keys the sport's stat schema does not have. */
  extra: Readonly<Record<string, string>>;
}

const role = (key: string, label: string, stats: SheetRole['stats'], more: Partial<SheetRole> = {}): SheetRole => ({ key, label, stats, ...more });
const ASSIST = role('assist', 'Assist', { assists: 1 });

// ── Team sports ────────────────────────────────────────────────────────────

const BASKETBALL: GameSheet = {
  sportKey: 'basketball',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Quarter', short: 'Q', regulation: 4, extra: 'OT' },
  scoreMode: 'total',
  events: [
    { key: 'fg2_made', label: '2-pointer made', short: '2PT', group: 'score', score: { points: 2, to: 'own' }, roles: [role('scorer', 'Scorer', { points: 2, fgm: 1, fga: 1 }), ASSIST] },
    { key: 'fg3_made', label: '3-pointer made', short: '3PT', group: 'score', score: { points: 3, to: 'own' }, roles: [role('scorer', 'Scorer', { points: 3, fgm: 1, fga: 1, threes: 1, tpa: 1 }), ASSIST] },
    { key: 'ft_made', label: 'Free throw made', short: 'FT', group: 'score', score: { points: 1, to: 'own' }, roles: [role('scorer', 'Shooter', { points: 1, ftm: 1, fta: 1 })] },
    { key: 'fg2_missed', label: '2-pointer missed', short: 'MISS', group: 'attack', roles: [role('shooter', 'Shooter', { fga: 1 })] },
    { key: 'fg3_missed', label: '3-pointer missed', short: 'MISS3', group: 'attack', roles: [role('shooter', 'Shooter', { fga: 1, tpa: 1 })] },
    { key: 'ft_missed', label: 'Free throw missed', short: 'FTX', group: 'attack', roles: [role('shooter', 'Shooter', { fta: 1 })] },
    { key: 'rebound_off', label: 'Offensive rebound', short: 'OREB', group: 'attack', roles: [role('player', 'Rebounder', { rebounds: 1, oreb: 1 })] },
    { key: 'rebound_def', label: 'Defensive rebound', short: 'DREB', group: 'defence', roles: [role('player', 'Rebounder', { rebounds: 1, dreb: 1 })] },
    { key: 'steal', label: 'Steal', short: 'STL', group: 'defence', roles: [role('player', 'Player', { steals: 1 })] },
    { key: 'block', label: 'Block', short: 'BLK', group: 'defence', roles: [role('player', 'Player', { blocks: 1 })] },
    { key: 'turnover', label: 'Turnover', short: 'TO', group: 'discipline', roles: [role('player', 'Player', { turnovers: 1 })] },
    { key: 'foul', label: 'Foul', short: 'PF', group: 'discipline', roles: [role('player', 'Player', { fouls: 1 })] },
  ],
  box: [
    { label: 'PTS', key: 'points' }, { label: 'REB', key: 'rebounds' }, { label: 'AST', key: 'assists' }, { label: 'STL', key: 'steals' }, { label: 'BLK', key: 'blocks' },
    { label: 'FG', key: ['fgm', 'fga'] }, { label: '3PT', key: ['threes', 'tpa'] }, { label: 'FT', key: ['ftm', 'fta'] }, { label: 'TO', key: 'turnovers' }, { label: 'PF', key: 'fouls' },
  ],
  team: [
    { label: 'Field goals', key: ['fgm', 'fga'] }, { label: '3-pointers', key: ['threes', 'tpa'] }, { label: 'Free throws', key: ['ftm', 'fta'] },
    { label: 'Rebounds', key: 'rebounds' }, { label: 'Offensive rebounds', key: 'oreb' }, { label: 'Assists', key: 'assists' }, { label: 'Steals', key: 'steals' },
    { label: 'Blocks', key: 'blocks' }, { label: 'Turnovers', key: 'turnovers' }, { label: 'Fouls', key: 'fouls' },
  ],
  extra: { tpa: '3-pointers attempted', oreb: 'Offensive rebounds', dreb: 'Defensive rebounds', fouls: 'Fouls' },
};

const SOCCER_GOAL_ROLES = [role('scorer', 'Scorer', { goals: 1, shots: 1, shots_on_target: 1 }), ASSIST] as const;
const SOCCER: GameSheet = {
  sportKey: 'soccer',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Half', short: 'H', regulation: 2, extra: 'ET' },
  scoreMode: 'total',
  events: [
    { key: 'goal', label: 'Goal', short: 'GOAL', group: 'score', score: { points: 1, to: 'own' }, roles: SOCCER_GOAL_ROLES },
    { key: 'penalty_goal', label: 'Penalty scored', short: 'PEN', group: 'score', score: { points: 1, to: 'own' }, roles: [role('scorer', 'Scorer', { goals: 1, shots: 1, shots_on_target: 1, penalty_goals: 1 })] },
    { key: 'own_goal', label: 'Own goal', short: 'OG', group: 'score', score: { points: 1, to: 'other' }, roles: [role('player', 'Player', { own_goals: 1 })] },
    { key: 'shot_on_target', label: 'Shot on target', short: 'SOT', group: 'attack', roles: [role('shooter', 'Shooter', { shots: 1, shots_on_target: 1 })] },
    { key: 'shot_off_target', label: 'Shot off target', short: 'SHOT', group: 'attack', roles: [role('shooter', 'Shooter', { shots: 1 })] },
    { key: 'penalty_missed', label: 'Penalty missed', short: 'PENX', group: 'attack', roles: [role('shooter', 'Taker', { shots: 1 })] },
    { key: 'save', label: 'Save', short: 'SV', group: 'defence', roles: [role('keeper', 'Goalkeeper', { saves: 1 })] },
    { key: 'tackle', label: 'Tackle', short: 'TKL', group: 'defence', roles: [role('player', 'Player', { tackles: 1 })] },
    { key: 'corner', label: 'Corner', short: 'CRN', group: 'attack', roles: [], team: { corners: 1 } },
    { key: 'offside', label: 'Offside', short: 'OFF', group: 'discipline', roles: [], team: { offsides: 1 } },
    { key: 'foul', label: 'Foul', short: 'FOUL', group: 'discipline', roles: [role('player', 'Player', { fouls: 1 })] },
    { key: 'yellow_card', label: 'Yellow card', short: 'YC', group: 'discipline', roles: [role('player', 'Player', { yellow_cards: 1 })] },
    { key: 'red_card', label: 'Red card', short: 'RC', group: 'discipline', roles: [role('player', 'Player', { red_cards: 1 })] },
    { key: 'substitution', label: 'Substitution', short: 'SUB', group: 'marker', roles: [role('on', 'Coming on', {}, { primary: false }), role('off', 'Going off', {}, { primary: false })] },
  ],
  box: [
    { label: 'G', key: 'goals' }, { label: 'A', key: 'assists' }, { label: 'SH', key: 'shots' }, { label: 'SOT', key: 'shots_on_target' },
    { label: 'SV', key: 'saves' }, { label: 'TKL', key: 'tackles' }, { label: 'FC', key: 'fouls' }, { label: 'YC', key: 'yellow_cards' }, { label: 'RC', key: 'red_cards' },
  ],
  team: [
    { label: 'Shots', key: 'shots' }, { label: 'Shots on target', key: 'shots_on_target' }, { label: 'Saves', key: 'saves' }, { label: 'Corners', key: 'corners' },
    { label: 'Fouls', key: 'fouls' }, { label: 'Offsides', key: 'offsides' }, { label: 'Yellow cards', key: 'yellow_cards' }, { label: 'Red cards', key: 'red_cards' },
  ],
  extra: { shots_on_target: 'Shots on target', penalty_goals: 'Penalty goals', own_goals: 'Own goals', corners: 'Corners', offsides: 'Offsides', fouls: 'Fouls', red_cards: 'Red cards' },
};

const hockeyGoal = (key: string, label: string, short: string, team?: StatDelta): SheetEvent => ({
  key, label, short, group: 'score', score: { points: 1, to: 'own' }, team,
  roles: [role('scorer', 'Scorer', { goals: 1, shots: 1 }), role('assist', 'Assist', { assists: 1 }, { max: 2 }), role('goalie', 'Goalie beaten', { goals_against: 1 }, { other: true, primary: false })],
});
const ICE_HOCKEY: GameSheet = {
  sportKey: 'ice_hockey',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Period', short: 'P', regulation: 3, extra: 'OT' },
  scoreMode: 'total',
  events: [
    hockeyGoal('goal', 'Goal', 'GOAL'),
    hockeyGoal('goal_pp', 'Power-play goal', 'PPG', { pp_goals: 1 }),
    hockeyGoal('goal_sh', 'Short-handed goal', 'SHG', { sh_goals: 1 }),
    hockeyGoal('goal_en', 'Empty-net goal', 'ENG', { en_goals: 1 }),
    { key: 'shot', label: 'Shot on goal', short: 'SOG', group: 'attack', roles: [role('shooter', 'Shooter', { shots: 1 })] },
    { key: 'save', label: 'Save', short: 'SV', group: 'defence', roles: [role('goalie', 'Goalie', { saves: 1 })] },
    { key: 'hit', label: 'Hit', short: 'HIT', group: 'defence', roles: [role('player', 'Player', { hits: 1 })] },
    { key: 'blocked_shot', label: 'Blocked shot', short: 'BLK', group: 'defence', roles: [role('player', 'Player', { blocks: 1 })] },
    { key: 'faceoff_win', label: 'Face-off won', short: 'FOW', group: 'attack', roles: [role('player', 'Player', { faceoff_wins: 1 })] },
    { key: 'penalty', label: 'Penalty', short: 'PEN', group: 'discipline', roles: [role('player', 'Player', { pim: 'value' })], takesValue: { kind: 'minutes', label: 'Minutes', min: 2, max: 20, default: 2 } },
  ],
  box: [
    { label: 'G', key: 'goals' }, { label: 'A', key: 'assists' }, { label: 'SOG', key: 'shots' }, { label: 'HIT', key: 'hits' }, { label: 'BLK', key: 'blocks' },
    { label: 'PIM', key: 'pim' }, { label: 'SV', key: 'saves' }, { label: 'GA', key: 'goals_against' },
  ],
  team: [
    { label: 'Shots on goal', key: 'shots' }, { label: 'Power-play goals', key: 'pp_goals' }, { label: 'Short-handed goals', key: 'sh_goals' }, { label: 'Hits', key: 'hits' },
    { label: 'Blocked shots', key: 'blocks' }, { label: 'Face-offs won', key: 'faceoff_wins' }, { label: 'Penalty minutes', key: 'pim' }, { label: 'Saves', key: 'saves' },
  ],
  extra: { pp_goals: 'Power-play goals', sh_goals: 'Short-handed goals', en_goals: 'Empty-net goals', faceoff_wins: 'Face-offs won' },
};

const VOLLEYBALL: GameSheet = {
  sportKey: 'volleyball',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Set', short: 'S', regulation: 5 },
  scoreMode: 'sets',
  setTarget: set => (set >= 5 ? 15 : 25),
  events: [
    { key: 'kill', label: 'Kill', short: 'KILL', group: 'score', score: { points: 1, to: 'own' }, roles: [role('attacker', 'Attacker', { kills: 1, attack_attempts: 1 }), role('assist', 'Setter', { assists: 1 })] },
    { key: 'ace', label: 'Ace', short: 'ACE', group: 'score', score: { points: 1, to: 'own' }, roles: [role('server', 'Server', { aces: 1 })] },
    { key: 'block', label: 'Block', short: 'BLK', group: 'score', score: { points: 1, to: 'own' }, roles: [role('blocker', 'Blocker', { blocks: 1 }, { max: 3 })] },
    { key: 'point', label: 'Point (opponent error)', short: 'PT', group: 'score', score: { points: 1, to: 'own' }, roles: [] },
    { key: 'attack_error', label: 'Attack error', short: 'ERR', group: 'discipline', score: { points: 1, to: 'other' }, roles: [role('attacker', 'Attacker', { attack_errors: 1, attack_attempts: 1 })] },
    { key: 'service_error', label: 'Service error', short: 'SE', group: 'discipline', score: { points: 1, to: 'other' }, roles: [role('server', 'Server', { service_errors: 1 })] },
    { key: 'attack', label: 'Attack kept in play', short: 'ATT', group: 'attack', roles: [role('attacker', 'Attacker', { attack_attempts: 1 })] },
    { key: 'dig', label: 'Dig', short: 'DIG', group: 'defence', roles: [role('player', 'Player', { digs: 1 })] },
  ],
  box: [
    { label: 'K', key: 'kills' }, { label: 'E', key: 'attack_errors' }, { label: 'TA', key: 'attack_attempts' }, { label: 'A', key: 'assists' },
    { label: 'SA', key: 'aces' }, { label: 'SE', key: 'service_errors' }, { label: 'DIG', key: 'digs' }, { label: 'BLK', key: 'blocks' },
  ],
  team: [
    { label: 'Kills', key: 'kills' }, { label: 'Attack errors', key: 'attack_errors' }, { label: 'Aces', key: 'aces' }, { label: 'Service errors', key: 'service_errors' },
    { label: 'Digs', key: 'digs' }, { label: 'Blocks', key: 'blocks' }, { label: 'Assists', key: 'assists' },
  ],
  extra: {},
};

const hit = (key: string, label: string, short: string, bases: number): SheetEvent => ({
  key, label, short, group: 'attack', roles: [role('batter', 'Batter', { hits: 1, at_bats: 1, total_bases: bases })],
});
const BASEBALL: GameSheet = {
  sportKey: 'baseball',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Inning', short: 'INN', regulation: 9, extra: 'Extra' },
  scoreMode: 'total',
  events: [
    { key: 'run', label: 'Run scored', short: 'RUN', group: 'score', score: { points: 1, to: 'own' }, roles: [role('runner', 'Runner', { runs: 1 }), role('rbi', 'Batted in by', { rbis: 1 }, { primary: false })] },
    { key: 'home_run', label: 'Home run', short: 'HR', group: 'score', score: { points: 1, to: 'own' }, roles: [role('batter', 'Batter', { hits: 1, at_bats: 1, home_runs: 1, runs: 1, rbis: 1, total_bases: 4 })] },
    hit('single', 'Single', '1B', 1),
    hit('double', 'Double', '2B', 2),
    hit('triple', 'Triple', '3B', 3),
    { key: 'walk', label: 'Walk', short: 'BB', group: 'attack', roles: [role('batter', 'Batter', { walks: 1 })] },
    { key: 'stolen_base', label: 'Stolen base', short: 'SB', group: 'attack', roles: [role('runner', 'Runner', { stolen_bases: 1 })] },
    { key: 'strikeout', label: 'Strikeout', short: 'K', group: 'defence', roles: [role('batter', 'Batter', { at_bats: 1, batter_strikeouts: 1 }), role('pitcher', 'Pitcher', { strikeouts: 1 }, { other: true, primary: false })] },
    { key: 'out', label: 'Out in play', short: 'OUT', group: 'defence', roles: [role('batter', 'Batter', { at_bats: 1 })] },
    { key: 'error', label: 'Fielding error', short: 'E', group: 'discipline', roles: [role('fielder', 'Fielder', { errors: 1 })] },
  ],
  box: [
    { label: 'AB', key: 'at_bats' }, { label: 'R', key: 'runs' }, { label: 'H', key: 'hits' }, { label: 'RBI', key: 'rbis' }, { label: 'HR', key: 'home_runs' },
    { label: 'BB', key: 'walks' }, { label: 'SO', key: 'batter_strikeouts' }, { label: 'SB', key: 'stolen_bases' }, { label: 'K', key: 'strikeouts' },
  ],
  team: [
    { label: 'Runs', key: 'runs' }, { label: 'Hits', key: 'hits' }, { label: 'Errors', key: 'errors' }, { label: 'Home runs', key: 'home_runs' },
    { label: 'Walks', key: 'walks' }, { label: 'Stolen bases', key: 'stolen_bases' }, { label: 'Strikeouts (batting)', key: 'batter_strikeouts' },
  ],
  extra: { total_bases: 'Total bases', walks: 'Walks', batter_strikeouts: 'Strikeouts (batting)', errors: 'Errors' },
};

const FOOTBALL: GameSheet = {
  sportKey: 'football',
  family: 'team',
  sideNoun: 'Team',
  period: { noun: 'Quarter', short: 'Q', regulation: 4, extra: 'OT' },
  scoreMode: 'total',
  events: [
    { key: 'touchdown', label: 'Touchdown', short: 'TD', group: 'score', score: { points: 6, to: 'own' }, roles: [role('scorer', 'Scorer', { touchdowns: 1 }), role('passer', 'Passer', { pass_touchdowns: 1 }, { primary: false })] },
    { key: 'extra_point', label: 'Extra point', short: 'XP', group: 'score', score: { points: 1, to: 'own' }, roles: [role('kicker', 'Kicker', { extra_points: 1 })] },
    { key: 'two_point', label: 'Two-point conversion', short: '2PT', group: 'score', score: { points: 2, to: 'own' }, roles: [role('scorer', 'Scorer', { two_point_conversions: 1 })] },
    { key: 'field_goal', label: 'Field goal', short: 'FG', group: 'score', score: { points: 3, to: 'own' }, roles: [role('kicker', 'Kicker', { field_goals: 1 })] },
    { key: 'safety', label: 'Safety', short: 'SAF', group: 'score', score: { points: 2, to: 'own' }, roles: [role('player', 'Player', { safeties: 1 })] },
    { key: 'interception', label: 'Interception', short: 'INT', group: 'defence', roles: [role('player', 'Defender', { interceptions: 1 })] },
    { key: 'sack', label: 'Sack', short: 'SACK', group: 'defence', roles: [role('player', 'Defender', { sacks: 1 })] },
    { key: 'fumble_recovery', label: 'Fumble recovered', short: 'FR', group: 'defence', roles: [role('player', 'Defender', { fumble_recoveries: 1 })] },
    { key: 'big_play', label: 'Big play', short: 'PLAY', group: 'attack', roles: [role('player', 'Player', { big_plays: 1 })] },
  ],
  box: [
    { label: 'TD', key: 'touchdowns' }, { label: 'PASS TD', key: 'pass_touchdowns' }, { label: 'FG', key: 'field_goals' }, { label: 'XP', key: 'extra_points' },
    { label: 'INT', key: 'interceptions' }, { label: 'SACK', key: 'sacks' }, { label: 'FR', key: 'fumble_recoveries' },
  ],
  team: [
    { label: 'Touchdowns', key: 'touchdowns' }, { label: 'Field goals', key: 'field_goals' }, { label: 'Interceptions', key: 'interceptions' }, { label: 'Sacks', key: 'sacks' }, { label: 'Fumbles recovered', key: 'fumble_recoveries' },
  ],
  extra: {
    touchdowns: 'Touchdowns', pass_touchdowns: 'Passing touchdowns', extra_points: 'Extra points', two_point_conversions: 'Two-point conversions', field_goals: 'Field goals',
    safeties: 'Safeties', interceptions: 'Interceptions', sacks: 'Sacks', fumble_recoveries: 'Fumbles recovered', big_plays: 'Big plays',
  },
};

const TENNIS: GameSheet = {
  sportKey: 'tennis',
  family: 'team',
  sideNoun: 'Player',
  period: { noun: 'Set', short: 'S', regulation: 5 },
  scoreMode: 'sets',
  setTarget: () => 6,
  events: [
    { key: 'game_won', label: 'Game won', short: 'GAME', group: 'score', score: { points: 1, to: 'own' }, roles: [role('player', 'Player', { games_won: 1 })] },
    { key: 'break', label: 'Break of serve', short: 'BRK', group: 'score', score: { points: 1, to: 'own' }, roles: [role('player', 'Player', { games_won: 1, breaks: 1 })] },
    { key: 'ace', label: 'Ace', short: 'ACE', group: 'attack', roles: [role('player', 'Server', { aces: 1 })] },
    { key: 'winner', label: 'Winner', short: 'WIN', group: 'attack', roles: [role('player', 'Player', { winners: 1 })] },
    { key: 'double_fault', label: 'Double fault', short: 'DF', group: 'discipline', roles: [role('player', 'Server', { double_faults: 1 })] },
    { key: 'unforced_error', label: 'Unforced error', short: 'UE', group: 'discipline', roles: [role('player', 'Player', { unforced_errors: 1 })] },
  ],
  box: [{ label: 'GAMES', key: 'games_won' }, { label: 'BRK', key: 'breaks' }, { label: 'ACE', key: 'aces' }, { label: 'WIN', key: 'winners' }, { label: 'DF', key: 'double_faults' }, { label: 'UE', key: 'unforced_errors' }],
  team: [{ label: 'Aces', key: 'aces' }, { label: 'Winners', key: 'winners' }, { label: 'Double faults', key: 'double_faults' }, { label: 'Unforced errors', key: 'unforced_errors' }, { label: 'Breaks', key: 'breaks' }],
  extra: { games_won: 'Games won', breaks: 'Breaks of serve', aces: 'Aces', winners: 'Winners', double_faults: 'Double faults', unforced_errors: 'Unforced errors' },
};

// ── Combat sports: two fighters; a finish ends it ──────────────────────────

const FIGHTER = (stats: SheetRole['stats']) => [role('fighter', 'Fighter', stats)] as const;
const finish = (key: string, label: string, short: string): SheetEvent => ({ key, label, short, group: 'result', roles: FIGHTER({}), finish: label });
const pointsValue = (label: string, dflt: number, max: number): SheetEvent['takesValue'] => ({ kind: 'points', label, min: 1, max, default: dflt });

const MMA: GameSheet = {
  sportKey: 'mma',
  family: 'combat',
  sideNoun: 'Fighter',
  period: { noun: 'Round', short: 'R', regulation: 5 },
  scoreMode: 'none',
  events: [
    { key: 'knockdown', label: 'Knockdown', short: 'KD', group: 'attack', roles: FIGHTER({ knockdowns: 1 }) },
    { key: 'sig_strike', label: 'Significant strike', short: 'STR', group: 'attack', roles: FIGHTER({ sig_strikes_landed: 1, sig_strikes_attempted: 1 }) },
    { key: 'takedown', label: 'Takedown', short: 'TD', group: 'attack', roles: FIGHTER({ takedowns: 1, takedown_attempts: 1 }) },
    { key: 'takedown_stuffed', label: 'Takedown defended', short: 'TDD', group: 'defence', roles: [role('fighter', 'Defender', { takedowns_defended: 1 }), role('attacker', 'Attempted by', { takedown_attempts: 1 }, { other: true, primary: false })] },
    { key: 'submission_attempt', label: 'Submission attempt', short: 'SUB?', group: 'attack', roles: FIGHTER({ submission_attempts: 1 }) },
    { key: 'reversal', label: 'Reversal', short: 'REV', group: 'defence', roles: FIGHTER({ reversals: 1 }) },
    finish('ko_tko', 'KO / TKO', 'KO'),
    finish('submission', 'Submission', 'SUB'),
    finish('decision', 'Decision', 'DEC'),
  ],
  box: [{ label: 'KD', key: 'knockdowns' }, { label: 'SIG STR', key: 'sig_strikes_landed' }, { label: 'TD', key: ['takedowns', 'takedown_attempts'] }, { label: 'SUB ATT', key: 'submission_attempts' }, { label: 'REV', key: 'reversals' }],
  team: [{ label: 'Knockdowns', key: 'knockdowns' }, { label: 'Significant strikes', key: 'sig_strikes_landed' }, { label: 'Takedowns', key: ['takedowns', 'takedown_attempts'] }, { label: 'Submission attempts', key: 'submission_attempts' }],
  extra: { takedowns_defended: 'Takedowns defended', reversals: 'Reversals' },
};

const BOXING: GameSheet = {
  sportKey: 'boxing',
  family: 'combat',
  sideNoun: 'Boxer',
  period: { noun: 'Round', short: 'R', regulation: 12 },
  scoreMode: 'none',
  events: [
    { key: 'knockdown', label: 'Knockdown', short: 'KD', group: 'attack', roles: FIGHTER({ knockdowns: 1 }) },
    { key: 'punch_landed', label: 'Clean punch', short: 'PUNCH', group: 'attack', roles: FIGHTER({ punches_landed: 1, punches_thrown: 1 }) },
    { key: 'combination', label: 'Combination', short: 'COMBO', group: 'attack', roles: FIGHTER({ combinations: 1 }) },
    { key: 'point_deduction', label: 'Point deduction', short: 'DED', group: 'discipline', roles: FIGHTER({ point_deductions: 1 }) },
    finish('ko', 'KO', 'KO'),
    finish('tko', 'TKO', 'TKO'),
    finish('decision', 'Decision', 'DEC'),
  ],
  box: [{ label: 'KD', key: 'knockdowns' }, { label: 'PUNCHES', key: 'punches_landed' }, { label: 'COMBOS', key: 'combinations' }, { label: 'DED', key: 'point_deductions' }],
  team: [{ label: 'Knockdowns', key: 'knockdowns' }, { label: 'Clean punches', key: 'punches_landed' }, { label: 'Combinations', key: 'combinations' }],
  extra: { combinations: 'Combinations', point_deductions: 'Point deductions' },
};

const WRESTLING: GameSheet = {
  sportKey: 'wrestling',
  family: 'combat',
  sideNoun: 'Wrestler',
  period: { noun: 'Period', short: 'P', regulation: 3, extra: 'OT' },
  scoreMode: 'total',
  events: [
    { key: 'takedown', label: 'Takedown', short: 'TD', group: 'score', score: { points: 'value', to: 'own' }, roles: FIGHTER({ takedowns: 1 }), takesValue: pointsValue('Points', 3, 5) },
    { key: 'escape', label: 'Escape', short: 'ESC', group: 'score', score: { points: 1, to: 'own' }, roles: FIGHTER({ escapes: 1 }) },
    { key: 'reversal', label: 'Reversal', short: 'REV', group: 'score', score: { points: 2, to: 'own' }, roles: FIGHTER({ reversals: 1 }) },
    { key: 'near_fall', label: 'Near fall', short: 'NF', group: 'score', score: { points: 'value', to: 'own' }, roles: FIGHTER({ near_fall_points: 'value' }), takesValue: pointsValue('Points', 2, 4) },
    { key: 'penalty_point', label: 'Penalty point', short: 'PEN', group: 'discipline', score: { points: 'value', to: 'other' }, roles: FIGHTER({ penalties: 1 }), takesValue: pointsValue('Points', 1, 2) },
    finish('pin', 'Pin', 'PIN'),
    finish('tech_fall', 'Technical fall', 'TF'),
    finish('decision', 'Decision', 'DEC'),
  ],
  box: [{ label: 'TD', key: 'takedowns' }, { label: 'ESC', key: 'escapes' }, { label: 'REV', key: 'reversals' }, { label: 'NF', key: 'near_fall_points' }, { label: 'PEN', key: 'penalties' }],
  team: [{ label: 'Takedowns', key: 'takedowns' }, { label: 'Escapes', key: 'escapes' }, { label: 'Reversals', key: 'reversals' }, { label: 'Near-fall points', key: 'near_fall_points' }],
  extra: { penalties: 'Penalties' },
};

const bjjPoints = (key: string, label: string, short: string, points: number, stats: SheetRole['stats']): SheetEvent => ({
  key, label, short, group: 'score', score: { points, to: 'own' }, roles: FIGHTER({ points, ...stats }),
});
const BJJ: GameSheet = {
  sportKey: 'bjj',
  family: 'combat',
  sideNoun: 'Competitor',
  period: { noun: 'Match', short: 'M', regulation: 1 },
  scoreMode: 'total',
  events: [
    bjjPoints('takedown', 'Takedown', 'TD', 2, { takedowns: 1 }),
    bjjPoints('sweep', 'Sweep', 'SWP', 2, { sweeps: 1 }),
    bjjPoints('knee_on_belly', 'Knee on belly', 'KOB', 2, {}),
    bjjPoints('guard_pass', 'Guard pass', 'PASS', 3, { passes: 1 }),
    bjjPoints('mount', 'Mount', 'MNT', 4, {}),
    bjjPoints('back_control', 'Back control', 'BACK', 4, {}),
    { key: 'advantage', label: 'Advantage', short: 'ADV', group: 'attack', roles: FIGHTER({ advantages: 1 }) },
    { key: 'submission_attempt', label: 'Submission attempt', short: 'SUB?', group: 'attack', roles: FIGHTER({ submission_attempts: 1 }) },
    { key: 'penalty', label: 'Penalty', short: 'PEN', group: 'discipline', roles: FIGHTER({ penalties: 1 }) },
    { key: 'submission', label: 'Submission', short: 'SUB', group: 'result', roles: FIGHTER({ submissions: 1 }), finish: 'Submission' },
    finish('decision', 'Decision', 'DEC'),
  ],
  box: [{ label: 'PTS', key: 'points' }, { label: 'ADV', key: 'advantages' }, { label: 'SWP', key: 'sweeps' }, { label: 'PASS', key: 'passes' }, { label: 'SUB ATT', key: 'submission_attempts' }, { label: 'PEN', key: 'penalties' }],
  team: [{ label: 'Points', key: 'points' }, { label: 'Advantages', key: 'advantages' }, { label: 'Sweeps', key: 'sweeps' }, { label: 'Guard passes', key: 'passes' }, { label: 'Submission attempts', key: 'submission_attempts' }],
  extra: { takedowns: 'Takedowns', penalties: 'Penalties' },
};

// ── Races and timed events: results, not a score ───────────────────────────

const ATHLETE = [role('athlete', 'Athlete', {})] as const;
const TIME = (label: string): SheetEvent['takesValue'] => ({ kind: 'time_ms', label, min: 1, max: 24 * 3_600_000 });
const raceSheet = (sportKey: string, noun: string, more: readonly SheetEvent[] = []): GameSheet => ({
  sportKey,
  family: 'race',
  sideNoun: 'Athlete',
  period: { noun, short: noun.slice(0, 1).toUpperCase(), regulation: 1 },
  scoreMode: 'none',
  events: [
    { key: 'start', label: `${noun} start`, short: 'START', group: 'marker', roles: [] },
    { key: 'split', label: 'Split', short: 'SPLIT', group: 'marker', roles: ATHLETE, takesValue: TIME('Split time') },
    { key: 'finish', label: 'Finish', short: 'FIN', group: 'result', roles: ATHLETE, takesValue: TIME('Finish time') },
    { key: 'move', label: 'Move / pass', short: 'MOVE', group: 'attack', roles: ATHLETE },
    ...more,
  ],
  box: [],
  team: [],
  extra: {},
});

const TRACK_FIELD = raceSheet('track_field', 'Event', [
  { key: 'attempt', label: 'Attempt (jump / throw)', short: 'ATT', group: 'result', roles: ATHLETE, takesValue: { kind: 'mark', label: 'Mark (cm)', min: 1, max: 100_000 } },
  { key: 'foul', label: 'Foul attempt', short: 'FOUL', group: 'discipline', roles: ATHLETE },
]);

// ── Golf: a scorecard by hole ──────────────────────────────────────────────

const GOLFER = [role('golfer', 'Golfer', {})] as const;
const GOLF: GameSheet = {
  sportKey: 'golf',
  family: 'golf',
  sideNoun: 'Golfer',
  period: { noun: 'Hole', short: 'H', regulation: 18 },
  scoreMode: 'none',
  events: [
    { key: 'hole_score', label: 'Hole finished', short: 'HOLE', group: 'result', roles: GOLFER, takesValue: { kind: 'strokes', label: 'Strokes', min: 1, max: 20 } },
    { key: 'tee_shot', label: 'Tee shot', short: 'TEE', group: 'marker', roles: GOLFER },
    { key: 'approach', label: 'Approach', short: 'APP', group: 'marker', roles: GOLFER },
    { key: 'short_game', label: 'Chip / bunker', short: 'CHIP', group: 'marker', roles: GOLFER },
    { key: 'putt', label: 'Putt', short: 'PUTT', group: 'marker', roles: GOLFER },
  ],
  box: [],
  team: [],
  extra: {},
};

/** Every sport the registry knows — the 15 that are on and the two that are off (so turning one on needs no sheet). */
export const GAME_SHEETS: Readonly<Record<string, GameSheet>> = {
  basketball: BASKETBALL,
  soccer: SOCCER,
  ice_hockey: ICE_HOCKEY,
  volleyball: VOLLEYBALL,
  baseball: BASEBALL,
  football: FOOTBALL,
  tennis: TENNIS,
  mma: MMA,
  boxing: BOXING,
  wrestling: WRESTLING,
  bjj: BJJ,
  swimming: raceSheet('swimming', 'Race'),
  running: raceSheet('running', 'Race'),
  cycling: raceSheet('cycling', 'Race'),
  rowing: raceSheet('rowing', 'Race'),
  track_field: TRACK_FIELD,
  golf: GOLF,
};

export function gameSheetFor(sportKey: string | null | undefined): GameSheet | null {
  return sportKey ? (GAME_SHEETS[sportKey] ?? null) : null;
}

export function sheetEvent(sheet: GameSheet, eventKey: string | null | undefined): SheetEvent | null {
  return eventKey ? (sheet.events.find(e => e.key === eventKey) ?? null) : null;
}

/** The first role's stats count for the side even with nobody named — unless the role says otherwise. */
export function rolePrimary(event: SheetEvent, r: SheetRole): boolean {
  return r.primary ?? event.roles[0] === r;
}

/** Every stat key a sheet can produce (its roles and its team-only numbers). */
export function sheetStatKeys(sheet: GameSheet): string[] {
  const keys = new Set<string>();
  for (const e of sheet.events) {
    for (const r of e.roles) for (const k of Object.keys(r.stats)) keys.add(k);
    for (const k of Object.keys(e.team ?? {})) keys.add(k);
  }
  return [...keys].sort();
}

/** The label of a period number: "Q3", "OT", "OT2", "Set 2", "Inning 7". */
export function periodLabel(sheet: GameSheet, period: number | null | undefined): string {
  if (!period || period < 1) return '';
  const { noun, short, regulation, extra } = sheet.period;
  if (period > regulation && extra) return period - regulation === 1 ? extra : `${extra}${period - regulation}`;
  return short.length <= 2 ? `${short}${period}` : `${noun} ${period}`;
}
