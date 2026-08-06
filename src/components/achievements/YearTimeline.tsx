'use client';

import { Edit2, Trash2, Trophy, Medal } from 'lucide-react';
import { parsePlacement, groupByYear } from '@/lib/achievements/display';
import { tierAccent } from './tier-colors';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { formatMonthYear } from '@/lib/profile-filters';
import type { Achievement } from '@/lib/achievements';

/**
 * The full record, grouped by year (newest first — the workout log's
 * month-header treatment). Takes the FILTERED list; the hero above stays
 * all-time on purpose. Podiums wear a tier-tinted Medal, everything else a
 * neutral Trophy.
 */

interface YearTimelineProps {
  achievements: Achievement[];
  isOwnProfile: boolean;
  onEdit: (a: Achievement) => void;
  onDelete: (a: Achievement) => void;
}

export default function YearTimeline({ achievements, isOwnProfile, onEdit, onDelete }: YearTimelineProps) {
  const groups = groupByYear(achievements);

  return (
    <div className="space-y-6">
      {groups.map(group => (
        <div key={group.year}>
          <h4 className="text-xs font-bold text-muted uppercase tracking-wide mb-3">
            {group.year}
            <span className="ml-2 font-medium text-faint normal-case">
              {group.items.length} {group.items.length === 1 ? 'achievement' : 'achievements'}
            </span>
          </h4>
          <div className="space-y-3">
            {group.items.map(a => (
              <AchievementRow
                key={a.id}
                achievement={a}
                isOwnProfile={isOwnProfile}
                onEdit={() => onEdit(a)}
                onDelete={() => onDelete(a)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AchievementRow({
  achievement, isOwnProfile, onEdit, onDelete,
}: {
  achievement: Achievement; isOwnProfile: boolean; onEdit: () => void; onDelete: () => void;
}) {
  const tier = parsePlacement(achievement.placement);
  const accent = tierAccent(tier);
  const sportLabel = achievement.sport_key
    ? SPORT_NAMES[achievement.sport_key] ?? achievement.sport_key
    : 'General';
  const meta = [formatMonthYear(achievement.achieved_on), achievement.organization]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${accent.circle}`}>
          {tier ? (
            <Medal className={`w-5 h-5 ${accent.text}`} aria-hidden="true" />
          ) : (
            <Trophy className="w-5 h-5 text-faint" aria-hidden="true" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h5 className="text-base font-bold text-primary leading-tight break-words">
                {achievement.title}
              </h5>
              <p className="text-sm text-muted mt-0.5">{meta}</p>
            </div>
            {isOwnProfile && (
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={onEdit}
                  className="ea-icon-btn ea-interactive flex items-center justify-center text-muted hover:text-secondary"
                  aria-label={`Edit ${achievement.title}`}
                >
                  <Edit2 className="w-4 h-4" />
                </button>
                <button
                  onClick={onDelete}
                  className="ea-icon-btn ea-interactive flex items-center justify-center text-faint hover:text-red-600"
                  aria-label={`Delete ${achievement.title}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 flex-wrap mt-2">
            <span
              className={`px-2 py-1 rounded-md text-xs font-semibold ${
                achievement.sport_key ? 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong' : 'bg-surface-sunken text-secondary'
              }`}
            >
              {sportLabel}
            </span>
            {achievement.placement && (
              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold ${accent.chip}`}>
                <Medal className="w-3 h-3" aria-hidden="true" />
                {achievement.placement}
              </span>
            )}
          </div>
          {achievement.description && (
            <p className="text-sm text-tertiary line-clamp-3 mt-2">{achievement.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
