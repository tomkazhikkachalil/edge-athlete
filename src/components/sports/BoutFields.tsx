'use client';

// A combat bout in the composer (Oct 16 2026, combat sports C3): the result
// (Win / Loss / Draw / No contest), how it ended — this sport's methods
// only — the round and time when it ended early, and its context (weight
// class, rounds scheduled, and the sport's own: amateur or pro, wrestling
// style, gi or no-gi and belt). Every part but the result is optional; the
// server re-checks all of it (bout.ts validateBout).

import { BOUT_CONTEXT_BY_SPORT, BOUT_METHODS_BY_SPORT, BOUT_RESULT_LABELS, BOUT_RESULTS, type Bout, type BoutContext, type ChoiceDef, type CombatSportKey } from '@/lib/sports/bout';

const RESULT_TONE: Record<string, string> = {
  W: 'bg-green-600 text-white border-green-600',
  L: 'bg-red-600 text-white border-red-600',
  D: 'bg-gray-600 text-white border-gray-600',
  NC: 'bg-gray-600 text-white border-gray-600',
};

/** A round's usual length, offered once rounds are scheduled. */
const DEFAULT_MINUTES: Record<CombatSportKey, number> = { mma: 5, boxing: 3, wrestling: 2, bjj: 6 };

const input = 'min-h-[44px] rounded-lg border border-border-strong bg-surface px-3 text-base text-primary';

function Chips({ label, field, choices, value, onPick }: { label: string; field: string; choices: readonly ChoiceDef[]; value: string | undefined; onPick: (v: string | undefined) => void }) {
  return (
    <fieldset data-bout-field={field}>
      <legend className="text-xs font-semibold text-secondary mb-1">{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {choices.map(c => (
          <button
            key={c.value}
            type="button"
            aria-pressed={value === c.value}
            onClick={() => onPick(value === c.value ? undefined : c.value)}
            className={`ea-interactive min-h-[44px] rounded-lg border px-3 text-sm font-semibold ${value === c.value ? 'border-brand bg-brand-soft text-brand-fg' : 'border-border-strong text-primary'}`}
            data-bout-option={c.value}
          >
            {c.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

export default function BoutFields({ sport, value, onChange }: { sport: CombatSportKey; value: Bout | undefined; onChange: (b: Bout | undefined) => void }) {
  const methods = BOUT_METHODS_BY_SPORT[sport];
  const ctx = BOUT_CONTEXT_BY_SPORT[sport];
  const method = methods.find(m => m.value === value?.method);
  const early = !!value?.method && !method?.distance;
  const context = value?.context ?? {};

  const set = (patch: Partial<Bout>) => {
    if (!value?.result && !patch.result) return;
    const next: Bout = { ...(value ?? { result: patch.result! }), ...patch };
    // A decision goes the distance: no round, no time.
    const m = methods.find(x => x.value === next.method);
    if (m?.distance) {
      delete next.round;
      delete next.time_s;
    }
    if (next.round === undefined) delete next.time_s;
    onChange(next);
  };
  const setContext = (patch: Partial<BoutContext>) => {
    const merged: BoutContext = { ...context, ...patch };
    for (const k of Object.keys(merged) as (keyof BoutContext)[]) if (merged[k] === undefined || merged[k] === '') delete merged[k];
    set({ context: Object.keys(merged).length > 0 ? merged : undefined });
  };
  const time = value?.time_s;

  return (
    <div className="space-y-3" data-bout-fields={sport}>
      <fieldset>
        <legend className="text-xs font-semibold text-secondary mb-1">Result</legend>
        <div className="grid grid-cols-4 gap-1.5">
          {BOUT_RESULTS.map(r => (
            <button
              key={r}
              type="button"
              aria-pressed={value?.result === r}
              aria-label={BOUT_RESULT_LABELS[r]}
              onClick={() => (value?.result === r ? onChange(undefined) : value ? set({ result: r }) : onChange({ result: r }))}
              className={`min-h-[44px] rounded-lg border text-sm font-bold ${value?.result === r ? RESULT_TONE[r] : 'bg-surface text-secondary border-border-strong'}`}
              data-bout-result={r}
            >
              {r}
            </button>
          ))}
        </div>
      </fieldset>
      {value && (
        <>
          <label className="block" data-bout-field="method">
            <span className="text-xs font-semibold text-secondary">How it ended</span>
            <select value={value.method ?? ''} onChange={e => set({ method: e.target.value || undefined })} className={`mt-1 w-full ${input}`}>
              <option value="">—</option>
              {methods.map(m => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {early && (
            <div className="flex flex-wrap gap-3">
              <label className="block" data-bout-field="round">
                <span className="text-xs font-semibold text-secondary">Round</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={15}
                  value={value.round ?? ''}
                  onChange={e => set({ round: e.target.value ? Math.max(1, Math.min(15, Math.round(Number(e.target.value)))) : undefined })}
                  className={`mt-1 block w-20 ${input}`}
                />
              </label>
              <fieldset data-bout-field="time">
                <legend className="text-xs font-semibold text-secondary">Time in the round</legend>
                <div className="mt-1 flex items-center gap-1">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={15}
                    aria-label="Minutes"
                    disabled={value.round === undefined}
                    value={time === undefined ? '' : Math.floor(time / 60)}
                    onChange={e => set({ time_s: (Number(e.target.value) || 0) * 60 + ((time ?? 0) % 60) })}
                    className={`w-16 ${input} disabled:opacity-50`}
                  />
                  <span className="text-secondary">:</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={59}
                    aria-label="Seconds"
                    disabled={value.round === undefined}
                    value={time === undefined ? '' : String(time % 60).padStart(2, '0')}
                    onChange={e => set({ time_s: Math.floor((time ?? 0) / 60) * 60 + Math.min(59, Number(e.target.value) || 0) })}
                    className={`w-16 ${input} disabled:opacity-50`}
                  />
                </div>
              </fieldset>
            </div>
          )}
          <div className="space-y-3">
            <label className="block" data-bout-field="weight_class">
              <span className="text-xs font-semibold text-secondary">Weight class</span>
              <input type="text" maxLength={40} placeholder="155 lb" value={context.weight_class ?? ''} onChange={e => setContext({ weight_class: e.target.value || undefined })} className={`mt-1 w-full ${input}`} />
            </label>
            <fieldset data-bout-field="format">
              <legend className="text-xs font-semibold text-secondary">Scheduled</legend>
              <div className="mt-1 flex items-center gap-1 text-sm text-secondary">
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={15}
                  aria-label="Rounds scheduled"
                  value={context.format?.rounds ?? ''}
                  onChange={e => {
                    const rounds = Number(e.target.value);
                    setContext({ format: rounds > 0 ? { rounds: Math.min(15, Math.round(rounds)), minutes: context.format?.minutes ?? DEFAULT_MINUTES[sport] } : undefined });
                  }}
                  className={`w-16 ${input}`}
                />
                ×
                <input
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={15}
                  aria-label="Minutes per round"
                  disabled={!context.format}
                  value={context.format?.minutes ?? ''}
                  placeholder={String(DEFAULT_MINUTES[sport])}
                  onChange={e => {
                    const minutes = Number(e.target.value);
                    if (context.format && minutes > 0) setContext({ format: { rounds: context.format.rounds, minutes: Math.min(15, minutes) } });
                  }}
                  className={`w-16 ${input} disabled:opacity-50`}
                />
                <span>min</span>
              </div>
            </fieldset>
          </div>
          {ctx.level && <Chips label="Level" field="level" choices={ctx.level} value={context.level} onPick={v => setContext({ level: v })} />}
          {ctx.style && <Chips label="Style" field="style" choices={ctx.style} value={context.style} onPick={v => setContext({ style: v })} />}
          {ctx.gi && <Chips label="Gi" field="gi" choices={ctx.gi} value={context.gi} onPick={v => setContext({ gi: v })} />}
          {ctx.belt && <Chips label="Belt" field="belt" choices={ctx.belt} value={context.belt} onPick={v => setContext({ belt: v })} />}
        </>
      )}
    </div>
  );
}
