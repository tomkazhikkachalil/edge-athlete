'use client';

import { GOLF_INPUT, GOLF_LABEL, GOLF_SELECT } from '@/components/golf/golf-form-styles';

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

/**
 * Step 4 of the golf round: the playing conditions, outdoor only (the list
 * drops this step for an indoor round). The three controls are the one-page
 * form's; the asterisks are gone — weather, temperature and wind were marked
 * required there but never enforced, and the step is skippable.
 */
interface ConditionsStepProps {
  value: ConditionsValue;
  onChange: (patch: Partial<ConditionsValue>) => void;
}

export default function ConditionsStep({ value, onChange }: ConditionsStepProps) {
  return (
    <div data-round-step="conditions">
      <h3 className="text-lg font-semibold text-primary mb-1 flex items-center">
        <i className="fas fa-cloud-sun mr-2 text-violet-500" aria-hidden="true"></i>
        Playing Conditions
      </h3>
      <p className="text-sm text-tertiary mb-4">Optional — skip if you&apos;d rather not say.</p>
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
          <label className={GOLF_LABEL} htmlFor="golf-temperature">Temperature (°F)</label>
          <input
            id="golf-temperature"
            type="number"
            value={value.temperature}
            onChange={e => onChange({ temperature: e.target.value })}
            className={GOLF_INPUT}
            placeholder="72"
            min="0"
            max="120"
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
    </div>
  );
}
