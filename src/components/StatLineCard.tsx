/**
 * StatLineCard — feed post body for stat-line sports (ice hockey,
 * volleyball, …). Schema-driven sibling of golf/GolfRoundCard.
 */

import { getStatSchema, formatResult, formatRaceTime, type StatLineData } from '@/lib/sports/stat-schemas';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { boutHeadline, isCombatSport } from '@/lib/sports/bout';

/** Race times read as times ("11.85s", "4:05.30"), not bare numbers. Every
 *  other sport's chips stay raw values. */
const formatChipValue = (sportKey: string, key: string, value: number): string =>
  sportKey === 'track_field' && key.startsWith('time_') ? formatRaceTime(value) : String(value);

const RESULT_STYLES: Record<string, string> = {
  W: 'bg-green-600 text-white',
  L: 'bg-red-600 text-white',
  T: 'bg-gray-600 text-white',
};

export default function StatLineCard({ line }: { line: StatLineData }) {
  const schema = getStatSchema(line.sport_key);
  if (!schema) return null;
  const sportDef = getSportDefinition(line.sport_key as SportKey);

  const enteredFields = schema.fields.filter(
    f => typeof line.stats[f.key] === 'number' && line.stats[f.key] > 0
  );
  // A bout: the pill is its letter (W / L / D / NC), its headline a line of its own.
  const bout = line.bout && isCombatSport(line.sport_key) ? line.bout : null;
  const result = bout ? bout.result : formatResult(line);

  return (
    <div className="bg-gradient-to-br from-violet-50 dark:from-violet-950/40 to-slate-100 dark:to-stone-900 rounded-lg p-3 mt-2 border border-violet-200 dark:border-violet-800">
      {/* Header: sport + opponent + result */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <i className={`${sportDef.icon_id} text-brand-fg-strong`} aria-hidden="true"></i>
          <div className="min-w-0">
            <div className="font-bold text-slate-900 dark:text-primary text-sm truncate">
              {line.opponent ? `vs ${line.opponent}` : `${sportDef.display_name} ${schema.activityNoun}`}
            </div>
            {(() => {
              if (!line.date) return null;
              const d = new Date(`${line.date}T00:00:00`);
              if (Number.isNaN(d.getTime())) return null; // guard malformed dates
              return (
                <div className="text-xs text-slate-600 dark:text-tertiary">
                  {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              );
            })()}
          </div>
        </div>
        {result && (
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-black tracking-wide ${
              RESULT_STYLES[bout ? (bout.result === 'D' ? 'T' : bout.result) : (line.result ?? '')] ?? 'bg-slate-600 text-white'
            }`}
            data-stat-line-result={result}
          >
            {result}
          </span>
        )}
      </div>
      {/* The pill carries the result; the line says how (empty for a bare result). */}
      {bout && isCombatSport(line.sport_key) && boutHeadline(line.sport_key, bout, { withResult: false }) && (
        <p className="mb-2 text-sm font-semibold text-slate-800 dark:text-secondary" data-bout-headline>
          {boutHeadline(line.sport_key, bout, { withResult: false })}
        </p>
      )}

      {/* Stat chips */}
      {enteredFields.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {enteredFields.map(f => (
            <div
              key={f.key}
              className="bg-surface/90 border border-violet-200 dark:border-violet-800 rounded-lg px-2.5 py-1.5 text-center shadow-sm"
              title={f.label}
            >
              <div className="text-base font-black text-slate-900 dark:text-primary leading-none">
                {formatChipValue(line.sport_key, f.key, line.stats[f.key])}
              </div>
              <div className="text-[10px] font-semibold text-slate-500 dark:text-muted mt-0.5">
                {f.shortLabel}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
