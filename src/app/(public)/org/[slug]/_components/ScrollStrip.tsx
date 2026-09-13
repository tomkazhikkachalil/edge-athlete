import type { ReactNode } from 'react';

// A horizontal, snap-scrolling strip — Site Builder program 3, D1b
// (Sep 13 2026). Server-safe and script-free (the (public) contract):
// `overflow-x: auto` + `scroll-snap-type: x mandatory` in globals.css
// (`.sb-strip`), a thin scrollbar, momentum on a phone. The strip and
// grid variants of the gallery, and later the sponsors' carousel and the
// news grid, ride it — one component, one CSS block.
export default function ScrollStrip({ children, itemWidth = '14rem', label, testId }: { children: ReactNode[]; itemWidth?: string; label: string; testId?: string }) {
  return (
    <ul role="list" aria-label={label} className="sb-strip mt-2" style={{ '--sb-item': itemWidth } as React.CSSProperties} data-sb-strip={testId ?? ''}>
      {children.map((c, i) => (
        <li key={i} className="sb-strip-item">
          {c}
        </li>
      ))}
    </ul>
  );
}
