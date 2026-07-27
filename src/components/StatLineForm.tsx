'use client';

/**
 * StatLineForm — generic per-game/per-match stat entry for stat-line sports
 * (ice hockey, volleyball, …). Entirely driven by the sport's stat schema —
 * adding a sport's composer form means adding a schema, not a component.
 */

import { getStatSchema, type StatLineData } from '@/lib/sports/stat-schemas';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';

interface StatLineFormProps {
  sportKey: SportKey;
  value: StatLineData;
  onChange: (next: StatLineData) => void;
}

export function emptyStatLine(sportKey: SportKey): StatLineData {
  return {
    type: 'stat_line',
    sport_key: sportKey,
    date: new Date().toISOString().slice(0, 10),
    stats: {},
  };
}

/** A stat line is postable when any stat or context detail was entered. */
export function statLineHasContent(line: StatLineData): boolean {
  return (
    Object.values(line.stats).some(v => typeof v === 'number' && v > 0) ||
    Boolean(line.opponent?.trim()) ||
    Boolean(line.result)
  );
}

export default function StatLineForm({ sportKey, value, onChange }: StatLineFormProps) {
  const schema = getStatSchema(sportKey);
  const sportDef = getSportDefinition(sportKey);
  if (!schema) return null;

  const setStat = (key: string, raw: string) => {
    const stats = { ...value.stats };
    if (raw === '') {
      delete stats[key];
    } else {
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) return;
      const field = schema.fields.find(f => f.key === key);
      stats[key] = field?.max !== undefined ? Math.min(n, field.max) : n;
    }
    onChange({ ...value, stats });
  };

  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200 space-y-4">
      <div className="flex items-center gap-2">
        <i className={`${sportDef.icon_id} text-violet-600`} aria-hidden="true"></i>
        <h3 className="text-sm font-bold text-gray-900">
          {schema.activityNoun} Stats
        </h3>
        <span className="text-xs text-gray-500">optional — fill in what you have</span>
      </div>

      {/* Context row: date / opponent / result */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label htmlFor={`${sportKey}-date`} className="block text-xs font-semibold text-gray-700 mb-1">
            {schema.activityNoun} Date
          </label>
          <input
            id={`${sportKey}-date`}
            type="date"
            value={value.date ?? ''}
            onChange={e => onChange({ ...value, date: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
          />
        </div>
        <div>
          <label htmlFor={`${sportKey}-opponent`} className="block text-xs font-semibold text-gray-700 mb-1">
            {schema.opponentLabel}
          </label>
          <input
            id={`${sportKey}-opponent`}
            type="text"
            maxLength={80}
            placeholder="e.g. Central High"
            value={value.opponent ?? ''}
            onChange={e => onChange({ ...value, opponent: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
          />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-700 mb-1">Result</label>
          <div className="flex gap-1">
            {(['W', 'L', 'T'] as const).map(r => (
              <button
                key={r}
                type="button"
                aria-pressed={value.result === r}
                onClick={() =>
                  onChange({ ...value, result: value.result === r ? undefined : r })
                }
                className={`flex-1 py-2 rounded-lg text-sm font-bold border transition-colors ${
                  value.result === r
                    ? r === 'W'
                      ? 'bg-green-600 text-white border-green-600'
                      : r === 'L'
                        ? 'bg-red-600 text-white border-red-600'
                        : 'bg-gray-600 text-white border-gray-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                {r}
              </button>
            ))}
            <input
              type="text"
              maxLength={11}
              placeholder="4-2"
              aria-label="Score"
              value={value.result_score ?? ''}
              onChange={e => onChange({ ...value, result_score: e.target.value })}
              className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-sm text-center text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
        </div>
      </div>

      {/* Stat fields grid */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {schema.fields.map(field => (
          <div key={field.key}>
            <label
              htmlFor={`${sportKey}-${field.key}`}
              className="block text-xs font-semibold text-gray-700 mb-1"
              title={field.label}
            >
              {field.label}
            </label>
            <input
              id={`${sportKey}-${field.key}`}
              type="number"
              inputMode="numeric"
              min={field.min ?? 0}
              max={field.max}
              placeholder="0"
              value={value.stats[field.key] ?? ''}
              onChange={e => setStat(field.key, e.target.value)}
              className="w-full px-2 py-2 border border-gray-300 rounded-lg text-sm text-center text-gray-900 placeholder-gray-400 focus:ring-2 focus:ring-violet-500 focus:border-violet-500"
            />
          </div>
        ))}
      </div>
    </div>
  );
}
