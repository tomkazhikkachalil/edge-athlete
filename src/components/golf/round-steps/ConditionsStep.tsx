'use client';

import KeySwitch from '@/components/mech/KeySwitch';
import { formatQuantity, fromInput, QUANTITY_UNITS, toDisplay, type UnitSystem } from '@/lib/activities/units';
import { formatWindKmh, WEATHER_ATTRIBUTION } from '@/lib/weather/weather';
import type { WeatherStatus } from '@/hooks/useWeather';
import { windOptionLabel } from '@/lib/golf/round-steps';
import FaIcon from '@/components/FaIcon';
import { faCloudSun } from '@/lib/icons/fa/cloud-sun';

// Plain words (Nov 24 2026): the emoji left the list — the dropdown's own
// line icon says "weather", and the summary reads the same words.
export const WEATHER_OPTIONS = [
  { value: 'sunny', label: 'Sunny' },
  { value: 'partly-cloudy', label: 'Partly cloudy' },
  { value: 'cloudy', label: 'Cloudy' },
  { value: 'rainy', label: 'Rainy' },
  { value: 'windy', label: 'Windy' },
] as const;

// "Light (5 to 10 mph)" — the ranges are round-steps.ts WIND_RANGE, the one
// spelling the summary uses too.
export const WIND_OPTIONS = (['calm', 'light', 'moderate', 'strong'] as const).map(value => ({
  value,
  label: windOptionLabel(value) ?? value,
}));

export function weatherLabel(value: string): string | null {
  return WEATHER_OPTIONS.find(o => o.value === value)?.label ?? null;
}
export function windLabel(value: string): string | null {
  return WIND_OPTIONS.find(o => o.value === value)?.label ?? null;
}

export interface ConditionsValue {
  weather: string;
  temperature: string;
  wind: string;
}

/** What the forecast button filled, for the line under the grid. */
export interface ForecastFilled {
  text: string;
  tempC: number;
  windKmh: number;
}

export interface ConditionsForecast {
  status: WeatherStatus;
  /** The tap: the composer resolves the course's coordinates and asks. */
  onUse: () => void;
  filled: ForecastFilled | null;
  /** The fields still hold what the forecast filled (the round's
   *  `conditionsSource` is 'forecast'): the key wears its selected ring. */
  applied?: boolean;
}

/** The temperature column is Fahrenheit; the field shows the viewer's unit. */
const F_MIN = 0;
const F_MAX = 120;
const tempShown = (stored: string, sys: UnitSystem): string => {
  if (stored.trim() === '') return '';
  const f = Number(stored);
  if (!Number.isFinite(f)) return stored;
  return String(Math.round(toDisplay('temp', fromInput('temp', f, 'imperial'), sys)));
};
const tempStored = (typed: string, sys: UnitSystem): string => {
  if (typed.trim() === '') return '';
  const v = Number(typed);
  if (!Number.isFinite(v)) return '';
  return String(Math.round(toDisplay('temp', fromInput('temp', v, sys), 'imperial')));
};

/**
 * Step 4 of the golf round: the playing conditions, outdoor only (the list
 * drops this step for an indoor round). Nothing here was ever required; the
 * step is skippable.
 *
 * Weather at the course (Oct 29 2026): for a LIVE round at a catalog course
 * the composer passes `forecast`, and one tap fills the three fields from the
 * conditions at the course right now (Open-Meteo, through our route). The
 * fields stay editable; the line at the foot says what came and credits the
 * source. An already-played round never sees the key. The temperature shows
 * in the viewer's unit (°C or °F) while the column keeps its Fahrenheit
 * meaning — the conversion lives at this one edge.
 *
 * The look (Tom's part 2 spec, Nov 24 2026 — the mechanical dialect): a
 * full-width forecast key that wears the selected ring while the fields
 * still hold what it filled (`applied`: an edit hands them back to the
 * person and the ring goes); a micro label over each control; the two
 * dropdowns as panels with a line icon and an up/down chevron (still native
 * selects, so the phone's own picker opens); the temperature in a recessed
 * slot beside a °F | °C key switch.
 */
interface ConditionsStepProps {
  value: ConditionsValue;
  onChange: (patch: Partial<ConditionsValue>) => void;
  /** The viewer's unit system (units.ts) — °C or °F on the temperature field. */
  sys?: UnitSystem;
  /** The °F / °C switch (Oct 29 2026): choosing a unit here is choosing the
   *  account's unit system (useUnitSystem.setSys — the device at once, the
   *  account in the background); the stored value stays Fahrenheit. */
  onUnit?: (sys: UnitSystem) => void;
  forecast?: ConditionsForecast;
}

const LINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

function SunIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false" {...LINE}>
      <circle cx="9" cy="9" r="3.2" />
      <path d="M9 1.6v1.8M9 14.6v1.8M1.6 9h1.8M14.6 9h1.8M3.8 3.8l1.3 1.3M12.9 12.9l1.3 1.3M3.8 14.2l1.3-1.3M12.9 5.1l1.3-1.3" />
    </svg>
  );
}

function WindIcon() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false" {...LINE}>
      <path d="M1.8 6.6h8.4a2.2 2.2 0 1 0-2.1-2.9" />
      <path d="M1.8 9.6h12a2.3 2.3 0 1 1-2.2 3" />
      <path d="M1.8 12.6h5.6" />
    </svg>
  );
}

/** A dropdown of the dialect: the native select, its arrow hidden, an icon
 *  slot on the left and an up/down chevron on the right. */
function Dropdown({ id, value, onChange, placeholder, options, icon }: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  options: readonly { value: string; label: string }[];
  icon: React.ReactNode;
}) {
  return (
    <div className="ea-mech-panel ea-mech-select relative h-12 rounded-xl">
      <span className="ea-mech-icon pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2">{icon}</span>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer appearance-none rounded-xl bg-transparent pl-[42px] pr-9 text-base sm:text-sm font-semibold text-[color:var(--mech-text)]"
      >
        <option value="">{placeholder}</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[color:var(--mech-label)]" {...LINE}>
        <path d="M4.5 6.2 8 2.9l3.5 3.3M4.5 9.8 8 13.1l3.5-3.3" />
      </svg>
    </div>
  );
}

const UNIT_OPTIONS = [
  { value: '°F', label: '°F' },
  { value: '°C', label: '°C' },
] as const;

export default function ConditionsStep({ value, onChange, sys = 'imperial', onUnit, forecast }: ConditionsStepProps) {
  const tempUnit = QUANTITY_UNITS.temp[sys] as '°F' | '°C';
  const min = Math.round(toDisplay('temp', fromInput('temp', F_MIN, 'imperial'), sys));
  const max = Math.round(toDisplay('temp', fromInput('temp', F_MAX, 'imperial'), sys));
  const checking = forecast?.status === 'loading';
  const applied = !!forecast?.applied;
  return (
    <div data-round-step="conditions" className="flex flex-col gap-2.5">
      {forecast && (
        <div data-golf-forecast-row="">
          <button
            type="button"
            onClick={forecast.onUse}
            disabled={checking}
            aria-busy={checking || undefined}
            aria-pressed={applied}
            data-golf-forecast=""
            {...(applied ? { 'data-applied': '' } : {})}
            className="ea-mech-panel ea-mech-btn ea-mech-forecast flex h-12 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold text-[color:var(--mech-text)] disabled:opacity-60"
          >
            <FaIcon icon={faCloudSun} className="ea-mech-icon text-[18px]" />
            {checking ? 'Checking…' : 'Use course forecast'}
          </button>
          {forecast.status === 'unavailable' && (
            <p className="mt-2 text-xs text-[color:var(--mech-text-soft)]" data-golf-forecast-none="" role="status">No forecast right now.</p>
          )}
        </div>
      )}

      <div>
        <label className="ea-mech-micro mb-2 block" htmlFor="golf-weather">Weather</label>
        <Dropdown id="golf-weather" value={value.weather} onChange={weather => onChange({ weather })} placeholder="Select weather" options={WEATHER_OPTIONS} icon={<SunIcon />} />
      </div>

      <div>
        <label className="ea-mech-micro mb-2 block" htmlFor="golf-temperature">Temperature</label>
        <div className="flex items-center gap-2">
          <span className="ea-mech-recess flex h-[50px] min-w-0 flex-1 items-center rounded-xl px-3.5">
            <input
              id="golf-temperature"
              type="number"
              inputMode="numeric"
              value={tempShown(value.temperature, sys)}
              onChange={e => onChange({ temperature: tempStored(e.target.value, sys) })}
              className="ea-mech-slot-input ea-mech-readout h-full w-full min-w-0 text-base"
              placeholder="--"
              min={min}
              max={max}
              data-golf-temperature-unit={tempUnit}
            />
          </span>
          {onUnit && (
            <span data-golf-temp-units="" className="shrink-0">
              <KeySwitch
                label="Temperature unit"
                size="sm"
                mono
                options={UNIT_OPTIONS}
                value={tempUnit}
                onChange={u => onUnit(u === '°F' ? 'imperial' : 'metric')}
                keyClassName="w-[50px]"
              />
            </span>
          )}
        </div>
      </div>

      <div>
        <label className="ea-mech-micro mb-2 block" htmlFor="golf-wind">Wind</label>
        <Dropdown id="golf-wind" value={value.wind} onChange={wind => onChange({ wind })} placeholder="Select wind" options={WIND_OPTIONS} icon={<WindIcon />} />
      </div>

      {forecast?.filled && (
        <p className="text-[11px] leading-4 text-[color:var(--mech-label)]" data-golf-forecast-note="">
          Tee off forecast · {forecast.filled.text}, {formatQuantity('temp', forecast.filled.tempC, sys)}, {formatWindKmh(forecast.filled.windKmh, sys)} ·{' '}
          <a href={WEATHER_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="underline" data-golf-forecast-attribution="">
            {WEATHER_ATTRIBUTION.text}
          </a>
        </p>
      )}
    </div>
  );
}
