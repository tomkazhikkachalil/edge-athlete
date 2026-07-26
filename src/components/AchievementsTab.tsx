'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Edit2, Trash2, Trophy, Medal } from 'lucide-react';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import AddAchievementModal from './AddAchievementModal';
import ConfirmModal from './ConfirmModal';
import { useToast } from './Toast';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import {
  GENERAL_SPORT_KEY,
  deriveYearOptions,
  formatMonthYear,
  matchesSportFilter,
  matchesYearFilter,
} from '@/lib/profile-filters';
import type { Achievement } from '@/lib/achievements';

interface AchievementsTabProps {
  profileId: string;
  isOwnProfile?: boolean;
}

export default function AchievementsTab({ profileId, isOwnProfile = false }: AchievementsTabProps) {
  const { showSuccess, showError } = useToast();
  const [achievements, setAchievements] = useState<Achievement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Achievement | null>(null);
  const [deleting, setDeleting] = useState<Achievement | null>(null);

  const fetchAchievements = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const response = await fetch(`/api/achievements?profileId=${profileId}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to fetch achievements');
      const data = await response.json();
      setAchievements(data.achievements || []);
    } catch (err) {
      console.error('Failed to load achievements:', err);
      setLoadError(true);
      setAchievements([]);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => {
    fetchAchievements();
  }, [fetchAchievements]);

  // Filter options derived from actual data — sports this athlete has
  // achievements in (plus General when any row has no sport), years present.
  const sportOptions = useMemo(() => {
    const keys = new Set<string>();
    let hasGeneral = false;
    for (const a of achievements) {
      if (a.sport_key) keys.add(a.sport_key);
      else hasGeneral = true;
    }
    const options = Array.from(keys)
      .sort((a, b) => (SPORT_NAMES[a] ?? a).localeCompare(SPORT_NAMES[b] ?? b))
      .map(key => ({ value: key, label: SPORT_NAMES[key] ?? key }));
    if (hasGeneral) options.push({ value: GENERAL_SPORT_KEY, label: 'General' });
    return options;
  }, [achievements]);

  const yearOptions = useMemo(
    () => deriveYearOptions(achievements.map(a => a.achieved_on)),
    [achievements]
  );

  const visible = achievements.filter(
    a =>
      matchesSportFilter(a.sport_key, selectedSports) &&
      matchesYearFilter(a.achieved_on, selectedYears)
  );

  const handleDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    try {
      const response = await fetch(`/api/achievements/${target.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to delete achievement');
      setAchievements(prev => prev.filter(a => a.id !== target.id));
      showSuccess('Success', 'Achievement deleted');
    } catch (err) {
      console.error('Failed to delete achievement:', err);
      showError('Error', 'Failed to delete achievement');
    }
  };

  const openAdd = () => {
    setEditing(null);
    setIsModalOpen(true);
  };

  const openEdit = (achievement: Achievement) => {
    setEditing(achievement);
    setIsModalOpen(true);
  };

  const hasAny = achievements.length > 0;
  const activeCount = selectedSports.length + selectedYears.length;

  return (
    <div className="w-full space-y-6">
      {/* Filters — only meaningful once there's data to narrow */}
      {!loading && hasAny && (
        <FilterBar
          resultCount={visible.length}
          resultNoun="achievement"
          activeCount={activeCount}
          onClearAll={() => {
            setSelectedSports([]);
            setSelectedYears([]);
          }}
          actions={
            isOwnProfile ? (
              <button
                onClick={openAdd}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Achievement
              </button>
            ) : undefined
          }
        >
          {sportOptions.length > 0 && (
            <MultiSelectDropdown<string>
              allLabel="All Sports"
              itemNounPlural="sports"
              searchPlaceholder="Search sports..."
              options={sportOptions}
              selected={selectedSports}
              onChange={setSelectedSports}
            />
          )}
          {yearOptions.length > 0 && (
            <MultiSelectDropdown<number>
              allLabel="All Years"
              itemNounPlural="years"
              searchPlaceholder="Search years..."
              options={yearOptions.map(year => ({ value: year, label: String(year) }))}
              selected={selectedYears}
              onChange={setSelectedYears}
            />
          )}
        </FilterBar>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Load error */}
      {!loading && loadError && (
        <div className="text-center py-16 px-4">
          <p className="text-gray-600 mb-4">Couldn&apos;t load achievements.</p>
          <button
            onClick={fetchAchievements}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors"
          >
            Try again
          </button>
        </div>
      )}

      {/* Empty state (no achievements at all) */}
      {!loading && !loadError && !hasAny && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-amber-50 flex items-center justify-center">
            <Trophy className="w-10 h-10 text-amber-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">No achievements yet</h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            {isOwnProfile
              ? 'Add your awards, titles, and milestones to build your athletic résumé over the years.'
              : "This athlete hasn't added achievements yet."}
          </p>
          {isOwnProfile && (
            <button
              onClick={openAdd}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Add Your First Achievement
            </button>
          )}
        </div>
      )}

      {/* Filtered-empty state */}
      {!loading && hasAny && visible.length === 0 && (
        <div className="text-center py-16 px-4">
          <p className="text-gray-600">No achievements match your filters.</p>
        </div>
      )}

      {/* Achievements grid — date-ordered newest first (API order) */}
      {!loading && visible.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {visible.map(achievement => (
            <AchievementCard
              key={achievement.id}
              achievement={achievement}
              isOwnProfile={isOwnProfile}
              onEdit={() => openEdit(achievement)}
              onDelete={() => setDeleting(achievement)}
            />
          ))}
        </div>
      )}

      <AddAchievementModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSaved={fetchAchievements}
        editing={editing}
      />

      <ConfirmModal
        isOpen={deleting !== null}
        title="Delete Achievement"
        message={`Delete "${deleting?.title ?? ''}"? This cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}

interface AchievementCardProps {
  achievement: Achievement;
  isOwnProfile: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function AchievementCard({ achievement, isOwnProfile, onEdit, onDelete }: AchievementCardProps) {
  const sportLabel = achievement.sport_key
    ? SPORT_NAMES[achievement.sport_key] ?? achievement.sport_key
    : 'General';
  const meta = [formatMonthYear(achievement.achieved_on), achievement.organization]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className="bg-white rounded-xl border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg transition-all duration-200 p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center flex-shrink-0">
          <Trophy className="w-5 h-5 text-amber-600" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-base font-bold text-gray-900 leading-tight break-words">
            {achievement.title}
          </h4>
          <p className="text-sm text-gray-500 mt-0.5">{meta}</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <span
          className={`px-2 py-1 rounded-md text-xs font-semibold ${
            achievement.sport_key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
          }`}
        >
          {sportLabel}
        </span>
        {achievement.placement && (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-semibold bg-amber-100 text-amber-700">
            <Medal className="w-3 h-3" aria-hidden="true" />
            {achievement.placement}
          </span>
        )}
      </div>

      {achievement.description && (
        <p className="text-sm text-gray-600 line-clamp-3">{achievement.description}</p>
      )}

      {isOwnProfile && (
        <div className="flex items-center gap-2 pt-2 mt-auto border-t border-gray-200">
          <button
            onClick={onEdit}
            className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors"
          >
            <Edit2 className="w-3 h-3" />
            Edit
          </button>
          <button
            onClick={onDelete}
            className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition-colors"
            aria-label={`Delete ${achievement.title}`}
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
