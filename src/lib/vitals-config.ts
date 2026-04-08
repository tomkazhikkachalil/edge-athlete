/**
 * Vitals Tracking Configuration
 * Sport-neutral physical performance metrics for long-term athlete development.
 * No sport-specific fields — this works for any athlete.
 */

export interface VitalMetricConfig {
  key: string;
  label: string;
  unit: string;
  /** true = lower is better (e.g. sprint time), false = higher is better, null = neutral (weight) */
  lower_is_better: boolean | null;
  /** 'decimal_seconds' = sub-minute times like "4.95", 'mm:ss' = multi-minute times, null = numeric */
  time_format: 'decimal_seconds' | 'mm:ss' | null;
  placeholder: string;
}

export interface VitalCategoryConfig {
  key: string;
  label: string;
  icon: string; // FontAwesome class
  color: string; // Tailwind color prefix (e.g. 'violet')
  metrics: VitalMetricConfig[];
}

export const VITAL_CATEGORIES: VitalCategoryConfig[] = [
  {
    key: 'speed',
    label: 'Speed & Agility',
    icon: 'fas fa-bolt',
    color: 'yellow',
    metrics: [
      { key: '40_yard_dash',   label: '40-Yard Dash',     unit: 'sec', lower_is_better: true,  time_format: 'decimal_seconds', placeholder: 'e.g. 4.95' },
      { key: '10_yard_split',  label: '10-Yard Split',    unit: 'sec', lower_is_better: true,  time_format: 'decimal_seconds', placeholder: 'e.g. 1.65' },
      { key: 'shuttle_run',    label: 'Shuttle / Agility',unit: 'sec', lower_is_better: true,  time_format: 'decimal_seconds', placeholder: 'e.g. 4.30' },
      { key: 'vertical_jump',  label: 'Vertical Jump',    unit: 'in',  lower_is_better: false, time_format: null,              placeholder: 'e.g. 32'   },
      { key: 'broad_jump',     label: 'Broad Jump',       unit: 'in',  lower_is_better: false, time_format: null,              placeholder: 'e.g. 108'  },
    ],
  },
  {
    key: 'strength',
    label: 'Strength',
    icon: 'fas fa-dumbbell',
    color: 'violet',
    metrics: [
      { key: 'bench_press',    label: 'Bench Press',      unit: 'lbs', lower_is_better: false, time_format: null, placeholder: 'e.g. 185' },
      { key: 'squat',          label: 'Squat',            unit: 'lbs', lower_is_better: false, time_format: null, placeholder: 'e.g. 225' },
      { key: 'deadlift',       label: 'Deadlift',         unit: 'lbs', lower_is_better: false, time_format: null, placeholder: 'e.g. 275' },
      { key: 'overhead_press', label: 'Overhead Press',   unit: 'lbs', lower_is_better: false, time_format: null, placeholder: 'e.g. 135' },
      { key: 'pull_ups',       label: 'Pull-Ups',         unit: 'reps',lower_is_better: false, time_format: null, placeholder: 'e.g. 12'  },
    ],
  },
  {
    key: 'conditioning',
    label: 'Conditioning',
    icon: 'fas fa-heart-pulse',
    color: 'red',
    metrics: [
      { key: 'mile_run',        label: '1-Mile Run',        unit: 'min', lower_is_better: true,  time_format: 'mm:ss', placeholder: 'e.g. 6:45' },
      { key: '5k_run',          label: '5K Run',            unit: 'min', lower_is_better: true,  time_format: 'mm:ss', placeholder: 'e.g. 22:30' },
      { key: 'resting_hr',      label: 'Resting Heart Rate',unit: 'bpm', lower_is_better: true,  time_format: null,    placeholder: 'e.g. 58'   },
      { key: 'vo2_max',         label: 'VO2 Max',           unit: 'ml/kg/min', lower_is_better: false, time_format: null, placeholder: 'e.g. 55' },
    ],
  },
  {
    key: 'body',
    label: 'Body Metrics',
    icon: 'fas fa-ruler-vertical',
    color: 'blue',
    metrics: [
      { key: 'height',    label: 'Height',       unit: 'in',  lower_is_better: null, time_format: null, placeholder: 'e.g. 72 (inches)' },
      { key: 'weight',    label: 'Weight',       unit: 'lbs', lower_is_better: null, time_format: null, placeholder: 'e.g. 185'         },
      { key: 'wingspan',  label: 'Wingspan',     unit: 'in',  lower_is_better: null, time_format: null, placeholder: 'e.g. 74'          },
      { key: 'body_fat',  label: 'Body Fat %',   unit: '%',   lower_is_better: null, time_format: null, placeholder: 'e.g. 12'          },
    ],
  },
];

/** Flat lookup map: metric_key → VitalMetricConfig */
export const VITAL_METRICS_MAP: Record<string, VitalMetricConfig> = VITAL_CATEGORIES.flatMap(
  c => c.metrics
).reduce((acc, m) => ({ ...acc, [m.key]: m }), {});

// ============================================================================
// Utility functions
// ============================================================================

/**
 * Derive athlete age at a given recorded date from their birthday.
 * Returns "Age 16" or null if birthday unknown.
 */
export function getAgeAtDate(
  birthday: string | null | undefined,
  recordedAt: string
): string | null {
  if (!birthday) return null;
  try {
    const birth = new Date(birthday);
    const recorded = new Date(recordedAt);
    let age = recorded.getFullYear() - birth.getFullYear();
    const monthDiff = recorded.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && recorded.getDate() < birth.getDate())) {
      age--;
    }
    if (age < 0 || age > 100) return null;
    return `Age ${age}`;
  } catch {
    return null;
  }
}

/**
 * Parse a time string to seconds for storage.
 * "4:32"  → 272  (mm:ss)
 * "22:15" → 1335 (mm:ss for 5K)
 * "4.95"  → 4.95 (decimal seconds for sprint)
 * Returns null if unparseable.
 */
export function parseTimeToSeconds(display: string): number | null {
  if (!display) return null;
  const trimmed = display.trim();
  if (trimmed.includes(':')) {
    const parts = trimmed.split(':');
    if (parts.length !== 2) return null;
    const mins = parseFloat(parts[0]);
    const secs = parseFloat(parts[1]);
    if (isNaN(mins) || isNaN(secs)) return null;
    return mins * 60 + secs;
  }
  const num = parseFloat(trimmed);
  return isNaN(num) ? null : num;
}

/**
 * Format stored seconds back to a display string.
 * 272 + 'min'  → "4:32"
 * 4.95 + 'sec' → "4.95 sec"
 */
export function formatSecondsToDisplay(seconds: number, timeFormat: 'decimal_seconds' | 'mm:ss'): string {
  if (timeFormat === 'mm:ss') {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  }
  return seconds.toString();
}

/**
 * Get display string for a vital entry's value.
 * Prefers value_display if set; otherwise formats value + unit.
 */
export function getVitalDisplayValue(
  value: number | null,
  valueDisplay: string | null,
  unit: string
): string {
  if (valueDisplay) return valueDisplay;
  if (value === null || value === undefined) return '—';
  return `${value} ${unit}`;
}

/**
 * Calculate how many years a metric has been tracked (from first to last entry).
 * Returns "1 year", "3 years", or "Since YYYY".
 */
export function getYearsTracked(firstDate: string, latestDate: string): string {
  const first = new Date(firstDate);
  const latest = new Date(latestDate);
  const firstYear = first.getFullYear();
  const latestYear = latest.getFullYear();
  const diff = latestYear - firstYear;
  if (diff === 0) return `Since ${firstYear}`;
  if (diff === 1) return '1 year';
  return `${diff} years`;
}

/**
 * Compute trend direction for a metric.
 * Returns '▲', '▼', or '—'
 */
export function getTrendArrow(
  firstValue: number | null,
  latestValue: number | null,
  lowerIsBetter: boolean | null
): '▲' | '▼' | '—' {
  if (firstValue === null || latestValue === null || lowerIsBetter === null) return '—';
  if (latestValue === firstValue) return '—';
  const improved = lowerIsBetter ? latestValue < firstValue : latestValue > firstValue;
  return improved ? '▲' : '▼';
}
