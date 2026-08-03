'use client';

import { useMemo, useRef, useState } from 'react';

export interface TrendChartPoint {
  label: string;      // x label (date)
  value: number;
  meta?: string;      // tooltip detail (e.g. course name)
}

interface TrendLineChartProps {
  title: string;
  points: TrendChartPoint[];
  color?: string;          // series color
  unit?: string;           // appended to values ('%', '')
  yDomain?: [number, number]; // fixed domain (e.g. [0,100] for percentages)
  rollingWindow?: number;  // 0 = no rolling-average overlay
  invertGood?: boolean;    // lower is better (score to par, putts)
  formatValue?: (v: number) => string;
}

// Plain-SVG line chart (no chart lib):
// 2px line, 8px+ hover targets via nearest-column lookup, 4px markers with a
// surface ring, recessive grid, crosshair + tooltip, and an optional dashed
// NEUTRAL rolling-average overlay (derived reference line — deliberately
// gray, dashed and direct-labeled so identity never rests on color alone).
// Labels are rendered in HTML, not SVG <text>: the SVG scales uniformly to
// the container (0.43× at a 320px phone), which rendered 10px axis text at an
// unreadable ~4.3px. HTML spans keep true pixel size at every width — their
// positions map through the same percent transform the tooltip already uses.
// With no SVG text to make room for, the pads shrink and the plot itself gets
// ~100px wider on phones.
const CHART_W = 600;
const CHART_H = 220;
const PAD = { top: 14, right: 12, bottom: 8, left: 8 };

export default function TrendLineChart({
  title,
  points,
  color = '#16a34a',
  unit = '',
  yDomain,
  rollingWindow = 5,
  formatValue,
}: TrendLineChartProps) {
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  const fmt = formatValue ?? ((v: number) => `${Math.round(v * 100) / 100}${unit}`);

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
    const innerH = CHART_H - PAD.top - PAD.bottom;
    const xFor = (i: number) =>
      PAD.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - ((v - lo) / (hi - lo)) * innerH;

    // Rolling average overlay
    const rolled: (number | null)[] = points.map((_, i) => {
      if (!rollingWindow || rollingWindow < 2 || i < rollingWindow - 1) return null;
      const window = values.slice(i - rollingWindow + 1, i + 1);
      return window.reduce((s, v) => s + v, 0) / window.length;
    });

    // ~4 recessive gridlines on nice-ish values
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
  }, [points, yDomain, rollingWindow]);

  if (points.length < 2) {
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
        <h3 className="text-sm font-semibold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 py-8 text-center">
          Log at least two rounds with this stat to see a trend.
        </p>
      </div>
    );
  }

  const linePath = xs.map((x, i) => `${i === 0 ? 'M' : 'L'}${x},${ys[i]}`).join(' ');
  const avgSegments: string[] = [];
  let seg = '';
  avgYs.forEach((y, i) => {
    if (y === null) { if (seg) { avgSegments.push(seg); seg = ''; } return; }
    seg += `${seg ? 'L' : 'M'}${xs[i]},${y} `;
  });
  if (seg) avgSegments.push(seg);
  const hasAvg = avgSegments.length > 0;
  let lastAvgIndex = -1;
  avgYs.forEach((y, i) => { if (y !== null) lastAvgIndex = i; });
  const lastAvgY: number | null = lastAvgIndex >= 0 ? avgYs[lastAvgIndex] : null;

  // Nearest-column hover: the hit target is the full column width, far
  // larger than the 4px marker.
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
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {hasAvg && (
          <div className="flex items-center gap-3 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-4 h-0.5 rounded" style={{ backgroundColor: color }} />
              Per round
            </span>
            <span className="flex items-center gap-1.5">
              <svg width="16" height="2" aria-hidden="true">
                <line x1="0" y1="1" x2="16" y2="1" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 3" />
              </svg>
              {rollingWindow}-round avg
            </span>
          </div>
        )}
      </div>

      {/* pb-4 makes room for the HTML date labels below the plot */}
      <div className="relative pb-4">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART_W} ${CHART_H}`}
          className="w-full h-auto touch-pan-y"
          role="img"
          aria-label={`${title}: ${points.length} rounds, latest ${fmt(points[points.length - 1].value)}`}
          onMouseMove={e => handleMove(e.clientX)}
          onMouseLeave={() => setHoverIndex(null)}
          onTouchStart={e => handleMove(e.touches[0].clientX)}
          onTouchMove={e => handleMove(e.touches[0].clientX)}
          onTouchEnd={() => setHoverIndex(null)}
        >
          {/* Recessive grid (labels are HTML overlays below).
              vectorEffect keeps every stroke at its true pixel width instead
              of hairline-izing at the phone's 0.43× scale. */}
          {ticks.map((t, i) => (
            <line
              key={i}
              x1={PAD.left}
              x2={CHART_W - PAD.right}
              y1={t.y}
              y2={t.y}
              stroke="#f3f4f6"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Rolling average overlay (neutral, dashed, direct-labeled) */}
          {avgSegments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />
          ))}

          {/* Series line + markers (surface ring) */}
          <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {xs.map((x, i) => (
            <circle
              key={i}
              cx={x}
              cy={ys[i]}
              r={hoverIndex === i ? 6 : 4.5}
              fill={color}
              stroke="#ffffff"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {/* Crosshair */}
          {hoverIndex !== null && (
            <line
              x1={xs[hoverIndex]}
              x2={xs[hoverIndex]}
              y1={PAD.top}
              y2={CHART_H - PAD.bottom}
              stroke="#d1d5db"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>

        {/* Axis labels — HTML so they stay readable at every width. Y ticks
            sit just above their gridline inside the plot (standard mobile
            chart treatment); the percent mapping matches the tooltip's. */}
        {ticks.map((t, i) => (
          <span
            key={i}
            className="absolute left-1 text-[10px] leading-none text-gray-400 pointer-events-none"
            style={{ top: `${(t.y / CHART_H) * 100}%`, transform: 'translateY(-120%)' }}
          >
            {Math.abs(maxY - minY) > 20 ? Math.round(t.v) : Math.round(t.v * 10) / 10}
          </span>
        ))}
        {hasAvg && lastAvgY !== null && (
          <span
            className="absolute right-1 rounded bg-white/85 px-1 text-[10px] font-semibold leading-tight text-gray-500 pointer-events-none"
            style={{ top: `${(lastAvgY / CHART_H) * 100}%`, transform: 'translateY(-50%)' }}
          >
            avg {fmt(
              points
                .slice(Math.max(0, lastAvgIndex - (rollingWindow - 1)), lastAvgIndex + 1)
                .reduce((s, p) => s + p.value, 0) /
                Math.min(rollingWindow, lastAvgIndex + 1)
            )}
          </span>
        )}
        <span className="absolute bottom-0 left-0 text-[10px] leading-none text-gray-400 pointer-events-none">
          {points[0].label}
        </span>
        <span className="absolute bottom-0 right-0 text-[10px] leading-none text-gray-400 pointer-events-none">
          {points[points.length - 1].label}
        </span>

        {/* Tooltip (HTML, positioned over the SVG) */}
        {hover && hoverIndex !== null && (
          <div
            className="absolute z-10 pointer-events-none bg-gray-900 text-white text-xs rounded-md px-2.5 py-1.5 shadow-lg whitespace-nowrap"
            style={{
              left: `${(xs[hoverIndex] / CHART_W) * 100}%`,
              top: 0,
              transform: `translateX(${xs[hoverIndex] > CHART_W * 0.7 ? '-100%' : '-50%'})`,
            }}
          >
            <div className="font-semibold">{fmt(hover.value)}</div>
            <div className="text-gray-300">{hover.label}{hover.meta ? ` · ${hover.meta}` : ''}</div>
          </div>
        )}
      </div>
    </div>
  );
}
