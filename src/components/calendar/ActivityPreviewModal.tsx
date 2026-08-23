'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, X } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { categoryColor } from '@/lib/calendar/categories';
import { activityHref, type ActivityPayload } from '@/lib/calendar/activity-overlay';
import { buildWorkoutStatsData, computeSummary } from '@/lib/workouts/summary';
import { serverToEntries, type ServerWorkoutSession } from '@/lib/workouts/serialize';
import WorkoutPostCard from '@/components/workouts/WorkoutPostCard';
import GolfRoundCard from '@/components/golf/GolfRoundCard';
import CourseInfoCard from '@/components/golf/CourseInfoCard';
import { embeddedCourseToInfo } from '@/lib/golf/course-info';
import type { EmbeddedCourseInfo } from '@/types/group-posts';
import type { GolfRound } from '@/types/golf';

// Preview for a completed activity that was NEVER shared to the feed, so no
// post exists to render. Shared activities go to PostDetailModal instead —
// that IS the feed layout — and never reach this component.
//
// The bodies here are the same components the feed uses: a synthesized
// stats_data payload drives the real WorkoutPostCard (identical chips, and
// its own expandable breakdown), and golf rounds render GolfRoundCard. The
// footer keeps the old deep link so nothing is lost versus navigating.

type Body =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'workout'; statsData: Record<string, unknown> }
  | { status: 'golf'; round: GolfRound & { course_info?: EmbeddedCourseInfo | null } };

export default function ActivityPreviewModal({
  activity,
  title,
  isOpen,
  onClose,
}: {
  activity: ActivityPayload | null;
  /** The calendar item's title (already ✓-prefixed). */
  title: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [body, setBody] = useState<Body>({ status: 'loading' });
  useBodyScrollLock(isOpen);

  // Clear the previous body during render so a stale activity never paints
  // while the new fetch is in flight (EventDetailModal pattern).
  const [syncedTarget, setSyncedTarget] = useState({ isOpen, activity });
  if (syncedTarget.isOpen !== isOpen || syncedTarget.activity !== activity) {
    setSyncedTarget({ isOpen, activity });
    if (isOpen && activity) setBody({ status: 'loading' });
  }

  // Inlined cancellable IIFE rather than calling a useCallback — the rule
  // flags the CALL SITE of any function containing setState, and lint sits
  // at the ratchet (see eslint.config.mjs).
  useEffect(() => {
    if (!isOpen || !activity) return;
    let cancelled = false;
    (async () => {
      try {
        if (activity.source === 'workout') {
          const res = await fetch(`/api/workouts/${activity.session_id}`, { credentials: 'include' });
          if (!res.ok) throw new Error('unavailable');
          const data = await res.json();
          const session = data.session as ServerWorkoutSession;
          const entries = serverToEntries(session);
          if (cancelled) return;
          setBody({
            status: 'workout',
            statsData: buildWorkoutStatsData({
              sessionId: session.id,
              title: session.title,
              durationSeconds: session.duration_seconds ?? 0,
              summary: computeSummary(entries),
            }),
          });
          return;
        }
        if (activity.source === 'golf_round') {
          const res = await fetch(`/api/golf/rounds/${activity.round_id}`, { credentials: 'include' });
          if (!res.ok) throw new Error('unavailable');
          const data = await res.json();
          if (cancelled) return;
          // The rounds GET already embeds course_info:golf_courses — feed it
          // through instead of discarding it (Tom's "course details in the
          // calendar quick view").
          setBody({
            status: 'golf',
            round: data.round as GolfRound & { course_info?: EmbeddedCourseInfo | null },
          });
          return;
        }
        if (!cancelled) setBody({ status: 'unavailable' });
      } catch {
        // Deleted or not visible to this viewer — the footer link still stands.
        if (!cancelled) setBody({ status: 'unavailable' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, activity]);

  if (!isOpen || !activity) return null;

  const color = categoryColor(activity.source === 'golf_round' ? 'game' : 'workout');

  return (
    <div
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-surface-raised rounded-lg shadow-xl max-w-lg w-full max-h-modal overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-border">
          <div className="flex items-center gap-3 min-w-0">
            <span className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${color.bg}`}>
              <CheckCircle2 className="w-5 h-5 text-white" aria-hidden="true" />
            </span>
            <h2 className="text-lg font-bold text-primary truncate">{title.replace(/^✓\s*/, '')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center text-faint hover:text-tertiary shrink-0"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {body.status === 'loading' ? (
          <div className="flex justify-center py-16">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand"></div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            <p className="text-xs text-muted">
              Completed · not shared to your feed
            </p>

            {body.status === 'workout' && <WorkoutPostCard statsData={body.statsData} />}
            {body.status === 'golf' && (
              <>
                <GolfRoundCard round={body.round} />
                {/* Course identity under the (frozen) round card: logo,
                    description, official scorecard, map link. */}
                {(() => {
                  const info = embeddedCourseToInfo(body.round.course_info);
                  return info ? <CourseInfoCard course={info} /> : null;
                })()}
              </>
            )}
            {body.status === 'unavailable' && (
              <p className="text-sm text-muted">Details unavailable.</p>
            )}

            <div className="border-t border-border-subtle pt-3">
              <a
                href={activityHref(activity)}
                className="text-sm text-brand-fg hover:underline font-medium"
              >
                Open full details
                <i className="fas fa-arrow-right ml-1.5 text-xs"></i>
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
