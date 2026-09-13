import type { PublicStaffRow } from '@/lib/org-sites/public-data';

/** Program 3, D1: `variant` — a list (today), or a grid of name cards. */
export default function StaffList({ staff, variant = 'list' }: { staff: PublicStaffRow[]; variant?: 'list' | 'grid' }) {
  if (variant === 'grid') {
    return (
      <ul className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3" data-variant="grid">
        {staff.map((s, i) => (
          <li key={`${s.name}-${i}`} className="rounded-lg border border-border bg-canvas px-3 py-2">
            <p className="text-sm font-medium text-primary">{s.name}</p>
            <p className="text-xs capitalize text-muted">{s.role}</p>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <ul className="mt-2 divide-y divide-border-subtle">
      {staff.map((s, i) => (
        <li
          key={`${s.name}-${i}`}
          className="py-2 flex items-baseline justify-between gap-4"
        >
          <span className="text-sm font-medium text-primary">{s.name}</span>
          <span className="text-xs text-muted capitalize shrink-0">{s.role}</span>
        </li>
      ))}
    </ul>
  );
}
