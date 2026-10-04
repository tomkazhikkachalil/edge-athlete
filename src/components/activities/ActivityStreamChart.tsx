'use client';

// One activity chart: distance on x, one column on y (elevation, pace or
// heart rate). Plain SVG, no chart library (the house's TrendLineChart
// rules): the plot scales to the container, the labels are HTML so they
// keep their pixel size on a phone. Pointer (mouse AND touch — pointer
// events) reads the nearest sample and tells the page, which marks it on
// the map. Values are formatted by the caller.

import { useMemo, useRef } from 'react';
import type { ChartSeries } from '@/lib/activities/charts';

const W = 600;
const H = 140;

interface Props {
  series: ChartSeries;
  formatY: (v: number) => string;
  formatX: (m: number) => string;
  hoverIndex: number | null;
  onHover: (i: number | null) => void;
  /** Live Activities (251): a segment's sample range, shaded on the plot. */
  highlightRange?: [number, number] | null;
}

export default function ActivityStreamChart({ series, formatY, formatX, hoverIndex, onHover, highlightRange }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { path, area, lo, hi, maxX } = useMemo(() => {
    const vals = series.y.filter((v): v is number => v !== null);
    let lo = vals.reduce((m, v) => (v < m ? v : m), vals[0] ?? 0);
    let hi = vals.reduce((m, v) => (v > m ? v : m), vals[0] ?? 1);
    if (hi - lo < 1e-6) {
      lo -= 1;
      hi += 1;
    }
    const pad = (hi - lo) * 0.08;
    lo -= pad;
    hi += pad;
    const maxX = series.x[series.x.length - 1] || 1;
    const px = (m: number) => (m / maxX) * W;
    const py = (v: number) => {
      const f = (v - lo) / (hi - lo);
      return series.invert ? f * H : H - f * H;
    };
    let path = '';
    let area = '';
    let open = false;
    let segStart = 0;
    for (let i = 0; i < series.y.length; i++) {
      const v = series.y[i];
      if (v === null) {
        if (open) area += `L ${px(series.x[i - 1]).toFixed(1)} ${H} L ${segStart.toFixed(1)} ${H} Z `;
        open = false;
        continue;
      }
      const x = px(series.x[i]).toFixed(1);
      const y = py(v).toFixed(1);
      if (!open) {
        path += `M ${x} ${y} `;
        area += `M ${x} ${H} L ${x} ${y} `;
        segStart = Number(x);
        open = true;
      } else {
        path += `L ${x} ${y} `;
        area += `L ${x} ${y} `;
      }
    }
    if (open) area += `L ${px(series.x[series.x.length - 1]).toFixed(1)} ${H} L ${segStart.toFixed(1)} ${H} Z`;
    return { path, area, lo, hi, maxX };
  }, [series]);

  const pick = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width <= 0) return;
    const target = ((clientX - r.left) / r.width) * maxX;
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < series.x.length; i++) {
      const dd = Math.abs(series.x[i] - target);
      if (dd < bestD) {
        bestD = dd;
        best = i;
      }
    }
    onHover(best);
  };

  const hv = hoverIndex !== null ? series.y[hoverIndex] : null;
  const hoverLeft = hoverIndex !== null ? (series.x[hoverIndex] / maxX) * 100 : null;
  const top = series.invert ? lo : hi;
  const bottom = series.invert ? hi : lo;

  return (
    <section className="ea-surface rounded-lg p-4" data-activity-chart={series.kind}>
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-primary">{series.title}</h3>
        <span className="text-sm text-secondary tabular-nums" aria-live="polite">
          {hv !== null && hv !== undefined && hoverIndex !== null ? `${formatY(hv)} · ${formatX(series.x[hoverIndex])}` : ''}
        </span>
      </div>
      <div className="flex gap-2">
        <div className="flex flex-col justify-between text-xs text-muted tabular-nums py-0.5 min-w-[3rem] text-right" aria-hidden="true">
          <span>{formatY(top)}</span>
          <span>{formatY(bottom)}</span>
        </div>
        <div
          ref={ref}
          className="relative flex-1 min-w-0 touch-pan-y select-none"
          onPointerMove={e => pick(e.clientX)}
          onPointerDown={e => pick(e.clientX)}
          onPointerLeave={() => onHover(null)}
          role="img"
          aria-label={`${series.title} over the route`}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full h-28">
            <path d={area} fill={series.color} opacity={0.12} />
            {highlightRange && series.x.length > 0 && (

              <rect

                x={((series.x[Math.max(0, Math.min(highlightRange[0], series.x.length - 1))] / (series.x[series.x.length - 1] || 1)) * W).toFixed(1)}

                y={0}

                width={Math.max(2, ((series.x[Math.min(series.x.length - 1, Math.max(highlightRange[0], highlightRange[1]))] - series.x[Math.max(0, Math.min(highlightRange[0], highlightRange[1]))]) / (series.x[series.x.length - 1] || 1)) * W).toFixed(1)}

                height={H}

                fill="#dc2626"

                opacity={0.15}

                data-chart-highlight=""

              />

            )}
            <path d={path} fill="none" stroke={series.color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          </svg>
          {hoverLeft !== null && (
            <div className="pointer-events-none absolute inset-y-0 w-px bg-primary/40" style={{ left: `${hoverLeft}%` }} />
          )}
        </div>
      </div>
      <div className="flex justify-between text-xs text-muted tabular-nums mt-1 pl-[3.5rem]" aria-hidden="true">
        <span>0</span>
        <span>{formatX(maxX)}</span>
      </div>
    </section>
  );
}
