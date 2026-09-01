import type { PublicStaffRow } from '@/lib/org-sites/public-data';

// Staff module: owner/manager names ONLY (Tom's phase-3 decision), and
// the names arrive already masked by publicDisplayName — nothing else
// (no handles, no avatars, no contact details) leaves the reader.
export default function StaffList({ staff }: { staff: PublicStaffRow[] }) {
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
