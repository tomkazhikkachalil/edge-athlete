'use client';

import Link from 'next/link';
import { ACTIVITY_TYPE_DEFS } from '@/lib/activities/catalog';
import type { DistanceUnit } from '@/lib/activities/format';
import { tilesFor } from '@/lib/activities/tiles';
import type { ActivityView } from '@/lib/activities/visibility';
import RouteThumb from '@/components/activities/RouteThumb';
import FaIcon from '@/components/FaIcon';
import { faLock } from '@/lib/icons/fa/lock';
import { activityGlyph } from '@/lib/activities/activity-icons';

export const shortActivityDate = (iso: string) => new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/**
 * One activity in Training's History (Training redesign PR 4, Nov 11 2026) —
 * the row the Activities section drew: the stored, already-trimmed route
 * thumbnail (or the type's glyph), the name, the type and day, the provider's
 * credit, and the type's first three tiles with a value ("45:00" for a yoga,
 * never "0 km"). It opens the activity's own page.
 */
export default function ActivityHistoryRow({ activity: a, unit }: { activity: ActivityView; unit: DistanceUnit }) {
  const def = ACTIVITY_TYPE_DEFS[a.type];
  const line = tilesFor(a, null, unit, 3).map(t => t.value).join(' · ');
  return (
    <Link href={`/activities/${a.id}`} className="ea-surface ea-interactive flex items-center gap-3 rounded-lg p-3" data-activity-item={a.id}>
      <div className="flex h-16 w-24 shrink-0 items-center justify-center rounded-md bg-surface-sunken text-brand-fg">
        {a.routePreview ? <RouteThumb preview={a.routePreview} className="h-full w-full" w={96} h={64} /> : <FaIcon icon={activityGlyph(def.icon)} className="text-xl" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-primary">
          {a.name}
          {a.owner?.onlyMe && <FaIcon icon={faLock} className="ml-2 text-xs text-muted" aria-label="Only me" />}
        </p>
        <p className="text-xs text-muted">
          {def.label} · {shortActivityDate(a.occurredOn)}
          {a.credit && <span data-activity-credit> · {a.credit}</span>}
        </p>
        <p className="mt-1 text-sm text-secondary tabular-nums">{line}</p>
      </div>
    </Link>
  );
}
