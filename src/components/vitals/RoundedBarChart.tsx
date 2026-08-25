'use client';

/**
 * Friendly rounded bars — HTML columns, no SVG. Bars scale in on mount via a
 * CSS-owned transform (reduced-motion safe, ends at transform: none). Zero
 * weeks render as a small stub so a gap in training is visible, not missing.
 */

export interface RoundedBar {
  label: string;
  value: number;
  /** Full text for the title tooltip, e.g. "Week of Jul 13 — 3 workouts". */
  meta?: string;
  highlight?: boolean;
}

interface RoundedBarChartProps {
  bars: RoundedBar[];
  /** CSS color for fills — pass a var() so it re-themes. */
  color: string;
  height?: number;
  formatValue?: (value: number) => string;
  ariaLabel: string;
  /** Show the value above highlighted bars (default) or every bar. */
  valueLabels?: 'highlight' | 'all';
}

export default function RoundedBarChart({
  bars,
  color,
  height = 96,
  formatValue = v => String(v),
  ariaLabel,
  valueLabels = 'highlight',
}: RoundedBarChartProps) {
  const max = Math.max(1, ...bars.map(b => b.value));

  return (
    <div role="img" aria-label={ariaLabel}>
      <div className="flex items-end justify-between gap-1.5" style={{ height }}>
        {bars.map((bar, i) => {
          const frac = bar.value / max;
          const showValue = bar.value > 0 && (valueLabels === 'all' || bar.highlight);
          return (
            <div
              key={`${bar.label}-${i}`}
              className="flex-1 min-w-0 h-full flex flex-col items-center justify-end gap-1"
              title={bar.meta ?? `${bar.label}: ${formatValue(bar.value)}`}
            >
              {showValue && (
                <span className="text-[10px] font-bold text-secondary tabular-nums leading-none">
                  {formatValue(bar.value)}
                </span>
              )}
              {bar.value > 0 ? (
                <div
                  className="vt-bar-in w-2.5 sm:w-3 rounded-full"
                  style={{
                    height: `${Math.max(10, frac * 100)}%`,
                    backgroundColor: color,
                    // Quieter fill for non-highlight bars, same hue family
                    opacity: bar.highlight ? 1 : 0.45,
                    animationDelay: `${i * 30}ms`,
                  }}
                />
              ) : (
                <div className="w-2.5 sm:w-3 h-1 rounded-full bg-surface-sunken" aria-hidden="true" />
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex justify-between gap-1.5">
        {bars.map((bar, i) => (
          <span
            key={`${bar.label}-${i}`}
            className={`flex-1 text-center text-[10px] leading-none truncate ${bar.highlight ? 'font-bold text-secondary' : 'text-faint'}`}
          >
            {bar.label}
          </span>
        ))}
      </div>
    </div>
  );
}
