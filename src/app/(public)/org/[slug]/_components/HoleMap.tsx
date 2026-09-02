import type { HoleGeometry, HoleLine } from '@/lib/golf/hole-geometry';
import { courseOverview, holeDiagram, holeYards } from '@/lib/golf/hole-svg';

// Hole diagrams (phase 6e S2): the cached OSM tee→green polyline drawn
// as an inline SVG — no tiles, no client JS, no third-party fetch, so
// it lives in the (public) segment by construction. The line rides the
// site's accent; the tee is a small dot, the green a larger one. OSM is
// ODbL: the attribution line renders wherever a diagram does.

export function HoleDiagram({ hole, size = 96 }: { hole: HoleLine; size?: number }) {
  const p = holeDiagram(hole);
  if (!p) return null;
  const yards = holeYards(hole);
  const label = [`Hole ${hole.hole}`, hole.par ? `par ${hole.par}` : null, yards ? `≈ ${yards} yards` : null]
    .filter(Boolean)
    .join(', ');
  return (
    <svg
      viewBox={p.viewBox}
      width={size}
      height={size}
      role="img"
      aria-label={label}
      className="shrink-0 rounded bg-emerald-50"
    >
      <path d={p.paths[0]} fill="none" stroke="var(--org-accent-strong)" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={p.tee[0].x} cy={p.tee[0].y} r={3.5} fill="var(--org-accent)" />
      <circle cx={p.green[0].x} cy={p.green[0].y} r={5.5} fill="#15803d" />
    </svg>
  );
}

export function CourseOverview({ geometry }: { geometry: HoleGeometry }) {
  const p = courseOverview(geometry.holes);
  if (!p) return null;
  return (
    <svg
      viewBox={p.viewBox}
      role="img"
      aria-label={`Course overview: ${geometry.holes.length} holes`}
      className="w-full max-w-md rounded-lg bg-emerald-50"
    >
      {p.paths.map((d, i) => (
        <g key={geometry.holes[i].hole}>
          <path d={d} fill="none" stroke="var(--org-accent-strong)" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
          <circle cx={p.tee[i].x} cy={p.tee[i].y} r={2} fill="var(--org-accent)" />
          <circle cx={p.green[i].x} cy={p.green[i].y} r={3} fill="#15803d" />
          <text x={p.label[i].x} y={p.label[i].y} fontSize={7} fontWeight={600} textAnchor="middle" dominantBaseline="middle" fill="#14532d">
            {geometry.holes[i].hole}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function GeometryAttribution({ source }: { source: HoleGeometry['source'] }) {
  if (source !== 'osm') return null;
  return (
    <p className="text-[10px] text-faint">
      Hole lines ©{' '}
      <a href="https://www.openstreetmap.org/copyright" rel="noopener noreferrer" target="_blank" className="underline">
        OpenStreetMap contributors
      </a>
      , ODbL. Lengths are the drawn line, not the scorecard.
    </p>
  );
}
