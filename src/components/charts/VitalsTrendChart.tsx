'use client';

import { useId, useMemo, useRef, useState } from 'react';
import type { TrendChartPoint } from './TrendLineChart';

/**
 * The Vitals dialect's line chart — a SIBLING of TrendLineChart, not a
 * restyle of it: golf trends keeps the original untouched. The load-bearing
 * decisions carry over verbatim (HTML axis labels and tooltip because SVG
 * text renders ~4.3px at a phone's 0.43× scale; nearest-column hover so the
 * hit target is the full column, not the 4px marker; vectorEffect on every
 * stroke). What's new: a soft gradient under the curve, a draw-on-mount
 * animation (CSS-owned → reduced-motion safe for free), amber star markers
 * on milestone points, a height prop, and no card chrome — the section that
 * hosts it owns the card and the heading, so `title` here only feeds aria.
 */

interface VitalsTrendChartProps {
  /** Feeds the aria-label (e2e pins svg[aria-label*=…]); not rendered. */
  title: string;
  points: TrendChartPoint[];
  color: string;
  yDomain?: [number, number];
  rollingWindow?: number;
  pointNoun?: string;
  emptyMessage?: string;
  formatValue?: (v: number) => string;
  height?: number;
  gradientFill?: boolean;
  animateDraw?: boolean;
  /** Indices into `points` that get a star marker (personal-best moments). */
  milestones?: number[];
}

const CHART_W = 600;
const PAD = { top: 14, right: 12, bottom: 8, left: 8 };

/** 5-point star polygon centered on (cx, cy). */
function starPoints(cx: number, cy: number, outer = 8, inner = 3.4): string {
  const pts: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(' ');
}

export default function VitalsTrendChart({
  title,
  points,
  color,
  yDomain,
  rollingWindow = 5,
  formatValue,
  pointNoun = 'entry',
  emptyMessage,
  height = 260,
  gradientFill = true,
  animateDraw = true,
  milestones = [],
}: VitalsTrendChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const gradientId = useId();
  const chartH = height;

  const fmt = formatValue ?? ((v: number) => `${Math.round(v * 100) / 100}`);
  const milestoneSet = useMemo(() => new Set(milestones), [milestones]);

  const { xs, ys, avgYs, ticks, minY, maxY } = useMemo(() => {
    const values = points.map(p => p.value);
    let lo = yDomain ? yDomain[0] : Math.min(...values);
    let hi = yDomain ? yDomain[1] : Math.max(...values);
    if (!yDomain) {
      const pad = Math.max((hi - lo) * 0.15, 0.5);
      lo -= pad;
      hi += pad;
    }
    if (hi === lo) { hi += 1; lo -= 1; }

    const innerW = CHART_W - PAD.left - PAD.right;
    const innerH = chartH - PAD.top - PAD.bottom;
    const xFor = (i: number) =>
      PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;

    const rolled: (number | null)[] = points.map((_, i) => {
      if (!rollingWindow || rollingWindow < 2 || i < rollingWindow - 1) return null;
      const window = values.slice(i - rollingWindow + 1, i + 1);
      return window.reduce((s, v) => s + v, 0) / window.length;
    });

    const tickCount = 4;
    const tickVals: number[] = [];
    for (let t = 0; t <= tickCount; t++) {
      tickVals.push(lo + ((hi - lo) * t) / tickCount);
    }

    return {
      xs: points.map((_, i) => xFor(i)),
      ys: values.map(yFor),
      avgYs: rolled.map(v => (v === null ? null : yFor(v))),
      ticks: tickVals.map(v => ({ v, y: yFor(v) })),
      minY: lo,
      maxY: hi,
    };
  }, [points, yDomain, rollingWindow, chartH]);

  if (points.length < 2) {
    return (
      <p className="text-sm text-muted py-10 text-center">
        {emptyMessage ?? `Log at least two ${pointNoun}s with this stat to see a trend.`}
      </p>
    );
  }

  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  const baseline = chartH - PAD.bottom;
  const areaPath = `${linePath} L${xs[xs.length - 1]},${baseline} L${xs[0]},${baseline} Z`;

  const avgSegments: string[] = [];
  let seg = '';
  avgYs.forEach((y, i) => {
    if (y === null) { if (seg) { avgSegments.push(seg); seg = ''; } return; }
    seg += `${seg ? 'L' : 'M'}${xs[i]},${y} `;
  });
  if (seg) avgSegments.push(seg);
  const hasAvg = avgSegments.length > 0;

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const xInView = ((clientX - rect.left) / rect.width) * CHART_W;
    let nearest = 0;
    let best = Infinity;
    xs.forEach((x, i) => {
      const d = Math.abs(x - xInView);
      if (d < best) { best = d; nearest = i; }
    });
    setHoverIndex(nearest);
  };

  const hover = hoverIndex !== null ? points[hoverIndex] : null;

  return (
    <div>
      {hasAvg && (
        <div className="flex items-center justify-end gap-3 text-xs text-muted mb-1">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
            Per {pointNoun}
          </span>
          <span className="flex items-center gap-1.5">
            <svg width="16" height="2" aria-hidden="true">
              <line x1="0" y1="1" x2="16" y2="1" stroke="var(--chart-ref)" strokeWidth="2" strokeDasharray="4 3" />
            </svg>
            {rollingWindow}-{pointNoun} avg
          </span>
        </div>
      )}

      {/* pb-4 makes room for the HTML date labels below the plot */}
      <div className="relative pb-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_W} ${chartH}`}
          className="w-full h-auto touch-pan-y"
          role="img"
          aria-label={`${title}: ${points.length} ${pointNoun}s, latest ${fmt(points[points.length - 1].value)}`}
          onMouseMove={e => handleMove(e.clientX)}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchStart={e => handleMove(e.touches[0].clientX)}
          onTouchMove={e => handleMove(e.touches[0].clientX)}
          onTouchEnd={() => setHoverIndex(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((t, i) => (
            <line
              key={i}
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="var(--chart-grid)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {gradientFill && (
            <path d={areaPath} fill={`url(#${gradientId})`} className={animateDraw ? 'vt-fade-in' : undefined} />
          )}

          {avgSegments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="var(--chart-ref)" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Series line — pathLength=1 normalizes the dash so one keyframe
              draws any curve; ends at offset 0 (its inline value). */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            pathLength={1}
            strokeDasharray={animateDraw ? '1' : undefined}
            strokeDashoffset={animateDraw ? 0 : undefined}
            className={animateDraw ? 'vt-draw' : undefined}
          />

          {xs.map((x, i) =>
            milestoneSet.has(i) ? (
              <polygon
                key={i}
                points={starPoints(x, ys[i], hoverIndex === i ? 10 : 8)}
                fill="var(--warning)"
                stroke="var(--surface)"
                strokeWidth="1.5"
                className={animateDraw ? 'vt-fade-in' : undefined}
              >
                <title>Personal best</title>
              </polygon>
            ) : (
              <circle
                key={i}
                cx={x}
                cy={ys[i]}
                r={hoverIndex === i ? 6 : 4.5}
                fill={color}
                stroke="var(--surface)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                className={animateDraw ? 'vt-fade-in' : undefined}
              />
            )
          )}

          {hoverIndex !== null && (
            <line
              x1={xs[hoverIndex]}
              x2={xs[hoverIndex]}
              y1={PAD.top}
              y2={chartH - PAD.bottom}
              stroke="var(--chart-crosshair)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute left-1 text-[10px] leading-none text-faint pointer-events-none"
            style={{ top: `${(t.y / chartH) * 100}%`, transform: 'translateY(-120%)' }}
          >
            {Math.abs(maxY - minY) > 20 ? Math.round(t.v) : Math.round(t.v * 10) / 10}
          </span>
        ))}
        <span className="absolute bottom-0 left-0 text-[10px] leading-none text-faint pointer-events-none">
          {points[0].label}
        </span>
        <span className="absolute bottom-0 right-0 text-[10px] leading-none text-faint pointer-events-none">
          {points[points.length - 1].label}
        </span>

        {hover && hoverIndex !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-surface-inverse text-inverse text-xs rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap"
            style={{
              left: `${(xs[hoverIndex] / CHART_W) * 100}%`,
              top: 0,
              transform: `translateX(${xs[hoverIndex] > CHART_W * 0.7 ? '-100%' : '-50%'})`,
            }}
          >
            <div className="font-semibold">
              {fmt(hover.value)}
              {milestoneSet.has(hoverIndex) ? ' ★' : ''}
            </div>
            <div className="text-inverse/70">{hover.label}{hover.meta ? ` · ${hover.meta}` : ''}</div>
          </div>
        )}
      </div>
    </div>
  );
}
