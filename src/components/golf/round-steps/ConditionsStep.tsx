'use client';

import { GOLF_INPUT, GOLF_LABEL, GOLF_SELECT } from '@/components/golf/golf-form-styles';
import { formatQuantity, fromInput, QUANTITY_UNITS, toDisplay, type UnitSystem } from '@/lib/activities/units';
import { formatWindKmh, WEATHER_ATTRIBUTION } from '@/lib/weather/weather';
import type { WeatherStatus } from '@/hooks/useWeather';

export const WEATHER_OPTIONS = [
  { value: 'sunny', label: '☀️ Sunny' },
  { value: 'partly-cloudy', label: '⛅ Partly Cloudy' },
  { value: 'cloudy', label: '☁️ Cloudy' },
  { value: 'rainy', label: '🌧️ Rainy' },
  { value: 'windy', label: '💨 Windy' },
] as const;

export const WIND_OPTIONS = [
  { value: 'calm', label: 'Calm (0-5 mph)' },
  { value: 'light', label: 'Light (5-10 mph)' },
  { value: 'moderate', label: 'Moderate (10-20 mph)' },
  { value: 'strong', label: 'Strong (20+ mph)' },
] as const;

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
 * drops this step for an indoor round). The three controls are the one-page
 * form's; the asterisks are gone — weather, temperature and wind were marked
 * required there but never enforced, and the step is skippable.
 *
 * Weather at the course (Oct 29 2026): for a LIVE round at a catalog course
 * the composer passes `forecast`, and one tap fills the three fields from the
 * conditions at the course right now (Open-Meteo, through our route). The
 * fields stay editable; the line under the grid says what came and credits
 * the source. An already-played round never sees the button. The
 * temperature shows in the viewer's unit (°C or °F) while the column keeps
 * its Fahrenheit meaning — the conversion lives at this one edge.
 */
interface ConditionsStepProps {
  value: ConditionsValue;
  onChange: (patch: Partial<ConditionsValue>) => void;
  /** The viewer's unit system (units.ts) — °C or °F on the temperature field. */
  sys?: UnitSystem;
  /** The °F / °C toggle (Oct 29 2026): choosing a unit here is choosing the
   *  account's unit system (useUnitSystem.setSys — the device at once, the
   *  account in the background); the stored value stays Fahrenheit. */
  onUnit?: (sys: UnitSystem) => void;
  forecast?: ConditionsForecast;
}

export default function ConditionsStep({ value, onChange, sys = 'imperial', onUnit, forecast }: ConditionsStepProps) {
  const tempUnit = QUANTITY_UNITS.temp[sys];
  const min = Math.round(toDisplay('temp', fromInput('temp', F_MIN, 'imperial'), sys));
  const max = Math.round(toDisplay('temp', fromInput('temp', F_MAX, 'imperial'), sys));
  const placeholder = String(Math.round(toDisplay('temp', fromInput('temp', 72, 'imperial'), sys)));
  const checking = forecast?.status === 'loading';
  return (
    <div data-round-step="conditions">
      <h3 className="text-lg font-semibold text-primary mb-1 flex items-center">
        <i className="fas fa-cloud-sun mr-2 text-violet-500" aria-hidden="true"></i>
        Playing Conditions
      </h3>
      {/* The "Optional" line is gone (Oct 29 2026): Skip in the footer says it. */}
      <div className="mb-4" aria-hidden="true"></div>
      {forecast && (
        <div className="mb-4 flex flex-wrap items-center gap-3" data-golf-forecast-row="">
          <button
            type="button"
            onClick={forecast.onUse}
            disabled={checking}
            aria-busy={checking || undefined}
            data-golf-forecast=""
            className="ea-interactive inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border-strong px-3 text-sm font-semibold text-primary disabled:opacity-60"
          >
            <i className="fas fa-cloud-sun text-brand-fg" aria-hidden="true"></i>
            {checking ? 'Checking…' : 'Use the forecast at the course'}
          </button>
          {forecast.status === 'unavailable' && (
            <span className="text-sm text-tertiary" data-golf-forecast-none="">No forecast right now.</span>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div>
          <label className={GOLF_LABEL} htmlFor="golf-weather">Weather</label>
          <select id="golf-weather" value={value.weather} onChange={e => onChange({ weather: e.target.value })} className={GOLF_SELECT}>
            <option value="">Select weather</option>
            {WEATHER_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
        <div>
          <div className="flex items-end justify-between gap-2">
            <label className={GOLF_LABEL} htmlFor="golf-temperature">Temperature ({tempUnit})</label>
            {onUnit && (
              <div className="mb-1 inline-flex rounded-full border border-border p-0.5" role="group" aria-label="Temperature unit" data-golf-temp-units="">
                {(['°F', '°C'] as const).map(u => {
                  const pressed = tempUnit === u;
                  return (
                    <button
                      key={u}
                      type="button"
                      onClick={() => onUnit(u === '°F' ? 'imperial' : 'metric')}
                      aria-pressed={pressed}
                      data-golf-temp-unit={u}
                      className={`ea-interactive rounded-full px-3 min-h-[36px] text-xs font-semibold ${pressed ? 'bg-brand text-white' : 'text-secondary'}`}
                    >
                      {u}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <input
            id="golf-temperature"
            type="number"
            value={tempShown(value.temperature, sys)}
            onChange={e => onChange({ temperature: tempStored(e.target.value, sys) })}
            className={GOLF_INPUT}
            placeholder={placeholder}
            min={min}
            max={max}
            data-golf-temperature-unit={tempUnit}
          />
        </div>
        <div>
          <label className={GOLF_LABEL} htmlFor="golf-wind">Wind</label>
          <select id="golf-wind" value={value.wind} onChange={e => onChange({ wind: e.target.value })} className={GOLF_SELECT}>
            <option value="">Select wind</option>
            {WIND_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>
      </div>
      {forecast?.filled && (
        <p className="mt-3 text-xs text-tertiary" data-golf-forecast-note="">
          Forecast at tee-off · {forecast.filled.text}, {formatQuantity('temp', forecast.filled.tempC, sys)}, {formatWindKmh(forecast.filled.windKmh, sys)} ·{' '}
          <a href={WEATHER_ATTRIBUTION.url} target="_blank" rel="noopener noreferrer" className="underline" data-golf-forecast-attribution="">
            {WEATHER_ATTRIBUTION.text}
          </a>
        </p>
      )}
    </div>
  );
}
