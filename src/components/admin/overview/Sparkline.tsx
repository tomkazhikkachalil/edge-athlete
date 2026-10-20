'use client';

/** A 12-ish point sparkline in the de-emphasis hue (the stat-tile contract); null points break the line. */
export default function Sparkline({ series, width = 96, height = 24, colorVar = '--ov-s0' }: { series: readonly (number | null)[]; width?: number; height?: number; colorVar?: string }) {
  const known = series.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="inline-block" style={{ width, height }} aria-hidden="true" />;
  const max = Math.max(1, ...known);
  const step = series.length > 1 ? width / (series.length - 1) : 0;
  let d = '';
  let pen = false;
  series.forEach((v, i) => {
    if (v === null) { pen = false; return; }
    const x = (i * step).toFixed(1);
    const y = (height - 1 - (v / max) * (height - 2)).toFixed(1);
    d += `${pen ? 'L' : 'M'}${x},${y} `;
    pen = true;
  });
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" className="shrink-0">
      <path d={d.trim()} fill="none" stroke={`var(${colorVar})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
