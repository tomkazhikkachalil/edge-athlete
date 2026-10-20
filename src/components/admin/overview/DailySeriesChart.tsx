'use client';

import { useMemo, useRef, useState } from 'react';
import { SERIES_VARS, SINGLE_VAR } from './palette';
import { compact } from '@/lib/platform-stats/overview';

export interface DailySeries {
  name: string;
  values: readonly (number | null)[];
}

/**
 * The Overview's daily chart (H2), plain SVG like TrendLineChart: one axis;
 * a lone series is a 2 px line in the brand hue, several are thin stacked
 * bars in the fixed categorical order with a 2 px surface gap; recessive
 * grid; nearest-column hover with a crosshair and an HTML tooltip (the hit
 * target is the whole column); HTML date labels (SVG text would shrink with
 * the viewBox); a legend only for ≥ 2 series, each also direct-labelled in
 * the tooltip; a table view for every chart (the relief rule for the two
 * light-mode hues under 3:1). Null days (before the first rollup) draw
 * nothing.
 */
const W = 600;
const H = 180;
const PAD = { top: 10, right: 8, bottom: 6, left: 8 };

export default function DailySeriesChart({ title, days, series, hook, unit = '' }: { title: string; days: readonly string[]; series: readonly DailySeries[]; hook: string; unit?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const shown = series.slice(0, 4);
  const stacked = shown.length > 1;

  const geo = useMemo(() => {
    const n = days.length;
    const innerW = W - PAD.left - PAD.right;
    const innerH = H - PAD.top - PAD.bottom;
    const totals = days.map((_, i) => shown.reduce((s, sr) => s + (sr.values[i] ?? 0), 0));
    const max = Math.max(1, ...totals);
    const xFor = (i: number) => PAD.left + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
    const yFor = (v: number) => PAD.top + innerH - (v / max) * innerH;
    const slot = n > 1 ? innerW / (n - 1) : innerW;
    const barW = Math.max(2, Math.min(18, slot * 0.7));
    const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => ({ v: max * t, y: yFor(max * t) }));
    return { xFor, yFor, barW, ticks, max, totals, innerH };
  }, [days, shown]);

  const known = days.some((_, i) => shown.some(s => s.values[i] !== null));
  const onMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bd = Infinity;
    days.forEach((_, i) => { const d = Math.abs(geo.xFor(i) - x); if (d < bd) { bd = d; best = i; } });
    setHover(best);
  };
  const colorOf = (k: number) => (stacked ? `var(${SERIES_VARS[k]})` : `var(${SINGLE_VAR})`);
  const linePath = !stacked
    ? (() => {
        let d = '';
        let pen = false;
        shown[0]?.values.forEach((v, i) => {
          if (v === null) { pen = false; return; }
          d += `${pen ? 'L' : 'M'}${geo.xFor(i).toFixed(1)},${geo.yFor(v).toFixed(1)} `;
          pen = true;
        });
        return d.trim();
      })()
    : '';
  const labelIdx = days.length <= 8 ? days.map((_, i) => i) : [0, Math.floor((days.length - 1) / 2), days.length - 1];
  const fmtDay = (d: string) => `${d.slice(5, 7)}/${d.slice(8, 10)}`;

  return (
    <div className="rounded-lg border border-border bg-surface p-3 ov-root" data-overview-chart={hook}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <h3 className="text-sm font-semibold text-primary">{title}</h3>
        <div className="flex items-center gap-3">
          {stacked && (
            <ul className="flex flex-wrap items-center gap-3 text-xs text-muted" aria-label={`${title} series`}>
              {shown.map((s, k) => (
                <li key={s.name} className="flex items-center gap-1.5">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: colorOf(k) }} aria-hidden="true" />
                  {s.name}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setTable(t => !t)} className="text-xs font-medium text-brand-fg underline min-h-[32px] px-1" data-overview-table-toggle="">
            {table ? 'Chart' : 'Table'}
          </button>
        </div>
      </div>
      {!known ? (
        <p className="text-sm text-muted py-8 text-center">No rollup yet for these days.</p>
      ) : table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-primary" data-overview-table="">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-1 pr-2 font-medium">Day</th>
                {shown.map(s => <th key={s.name} className="py-1 pr-2 font-medium text-right">{s.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d} className="border-t border-border">
                  <td className="py-1 pr-2 tabular-nums">{d}</td>
                  {shown.map(s => <td key={s.name} className="py-1 pr-2 text-right tabular-nums">{s.values[i] === null ? '—' : `${compact(s.values[i])}${unit}`}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative pb-4">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${W} ${H}`}
            className="w-full h-auto touch-pan-y"
            role="img"
            aria-label={`${title}, ${days.length} days`}
            onMouseMove={e => onMove(e.clientX)}
            onMouseLeave={() => setHover(null)}
            onTouchStart={e => onMove(e.touches[0].clientX)}
            onTouchMove={e => onMove(e.touches[0].clientX)}
            onTouchEnd={() => setHover(null)}
          >
            {geo.ticks.map((t, i) => (
              <line key={i} x1={PAD.left} x2={W - PAD.right} y1={t.y} y2={t.y} stroke="var(--chart-grid)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {stacked
              ? days.map((_, i) => {
                  let acc = 0;
                  return shown.map((s, k) => {
                    const v = s.values[i] ?? 0;
                    if (v <= 0) return null;
                    const y0 = geo.yFor(acc);
                    const y1 = geo.yFor(acc + v);
                    acc += v;
                    return (
                      <rect
                        key={`${i}-${k}`}
                        x={geo.xFor(i) - geo.barW / 2}
                        y={y1}
                        width={geo.barW}
                        height={Math.max(0, y0 - y1 - 2)}
                        rx={k === shown.length - 1 || acc >= geo.totals[i] ? 2 : 0}
                        fill={colorOf(k)}
                      />
                    );
                  });
                })
              : (
                <>
                  <path d={linePath} fill="none" stroke={colorOf(0)} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                  {shown[0]?.values.map((v, i) => v === null ? null : (
                    <circle key={i} cx={geo.xFor(i)} cy={geo.yFor(v)} r={hover === i ? 5 : 3} fill={colorOf(0)} stroke="var(--surface)" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                  ))}
                </>
              )}
            {hover !== null && (
              <line x1={geo.xFor(hover)} x2={geo.xFor(hover)} y1={PAD.top} y2={H - PAD.bottom} stroke="var(--chart-crosshair)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          {labelIdx.map(i => (
            <span key={i} className="absolute bottom-0 text-[10px] text-muted tabular-nums" style={{ left: `${(geo.xFor(i) / W) * 100}%`, transform: 'translateX(-50%)' }}>
              {fmtDay(days[i])}
            </span>
          ))}
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded-md bg-surface-inverse px-2 py-1 text-xs text-surface shadow" style={{ left: `${(geo.xFor(hover) / W) * 100}%`, transform: `translateX(${hover > days.length / 2 ? '-100%' : '0'})` }} data-overview-tooltip="">
              <div className="font-semibold tabular-nums">{days[hover]}</div>
              {shown.map((s, k) => (
                <div key={s.name} className="flex items-center gap-1.5 tabular-nums">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: colorOf(k) }} aria-hidden="true" />
                  {stacked ? `${s.name}: ` : ''}{s.values[hover] === null ? '—' : `${compact(s.values[hover])}${unit}`}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
