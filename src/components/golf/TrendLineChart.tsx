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
const CHART_W = 600;
const CHART_H = 220;
const PAD = { top: 14, right: 76, bottom: 26, left: 40 };

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

      <div className="relative">
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
          {/* Recessive grid + y labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={CHART_W - PAD.right} y1={t.y} y2={t.y} stroke="#f3f4f6" strokeWidth="1" />
              <text x={PAD.left - 6} y={t.y + 3} textAnchor="end" fontSize="10" fill="#9ca3af">
                {Math.abs(maxY - minY) > 20 ? Math.round(t.v) : Math.round(t.v * 10) / 10}
              </text>
            </g>
          ))}

          {/* x labels: first and last date */}
          <text x={xs[0]} y={CHART_H - 8} textAnchor="start" fontSize="10" fill="#9ca3af">
            {points[0].label}
          </text>
          <text x={xs[xs.length - 1]} y={CHART_H - 8} textAnchor="end" fontSize="10" fill="#9ca3af">
            {points[points.length - 1].label}
          </text>

          {/* Rolling average overlay (neutral, dashed, direct-labeled) */}
          {avgSegments.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#6b7280" strokeWidth="2" strokeDasharray="4 3" />
          ))}
          {hasAvg && lastAvgY !== null && (
            <text
              x={xs[lastAvgIndex] + 6}
              y={lastAvgY + 3}
              fontSize="10"
              fill="#6b7280"
              fontWeight="600"
            >
              avg {fmt(
                points
                  .slice(Math.max(0, lastAvgIndex - (rollingWindow - 1)), lastAvgIndex + 1)
                  .reduce((s, p) => s + p.value, 0) /
                  Math.min(rollingWindow, lastAvgIndex + 1)
              )}
            </text>
          )}

          {/* Series line + markers (surface ring) */}
          <path d={linePath} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {xs.map((x, i) => (
            <circle
              key={i}
              cx={x}
              cy={ys[i]}
              r={hoverIndex === i ? 5 : 3.5}
              fill={color}
              stroke="#ffffff"
              strokeWidth="2"
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
            />
          )}
        </svg>

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
