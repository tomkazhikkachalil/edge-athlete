'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trophy } from 'lucide-react';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import AddAchievementModal from './AddAchievementModal';
import ConfirmModal from './ConfirmModal';
import SectionEmptyState from './SectionEmptyState';
import AchievementsHero from './achievements/AchievementsHero';
import TopFinishes from './achievements/TopFinishes';
import YearTimeline from './achievements/YearTimeline';
import { useToast } from './Toast';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { achievementStats } from '@/lib/achievements/display';
import {
  GENERAL_SPORT_KEY,
  deriveYearOptions,
  matchesSportFilter,
  matchesYearFilter,
} from '@/lib/profile-filters';
import type { Achievement } from '@/lib/achievements';

/**
 * The trophy case. Order is the argument: career stat tiles (all-time,
 * never filtered — "12 achievements" must not lie to match a filter), the
 * Top Finishes showcase (auto-picked podiums), then the filterable
 * year-grouped record.
 */

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

  // Inlined cancellable IIFE; retry and post-save refresh bump reloadKey
  // (both were fire-and-forget calls, so nothing awaited them).
  const [reloadKey, setReloadKey] = useState(0);
  const refetchAchievements = () => setReloadKey(k => k + 1);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const response = await fetch(`/api/achievements?profileId=${profileId}`, {
          credentials: 'include',
        });
        if (!response.ok) throw new Error('Failed to fetch achievements');
        const data = await response.json();
        if (!cancelled) setAchievements(data.achievements || []);
      } catch (err) {
        console.error('Failed to load achievements:', err);
        if (cancelled) return;
        setLoadError(true);
        setAchievements([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [profileId, reloadKey]);

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

  const visible = useMemo(
    () =>
      achievements.filter(
        a =>
          matchesSportFilter(a.sport_key, selectedSports) &&
          matchesYearFilter(a.achieved_on, selectedYears)
      ),
    [achievements, selectedSports, selectedYears]
  );

  const stats = useMemo(() => achievementStats(achievements), [achievements]);

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

  if (loading) {
    return (
      <div className="flex justify-center items-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="text-center py-16 px-4">
        <p className="text-tertiary mb-4">Couldn&apos;t load achievements.</p>
        <button
          onClick={refetchAchievements}
          className="inline-flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand-hover transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      {/* ── Header ───────────────────────────────────────────────────── */}
      <div>
        <h2 className="text-h2 text-primary">Achievements</h2>
        <p className="text-sm text-muted mt-0.5">
          Awards, titles, and milestones — the athletic résumé.
        </p>
      </div>

      {/* ── Hero: career totals — always all-time, never filtered ────── */}
      <AchievementsHero stats={stats} />

      {/* ── Top Finishes — auto-picked podiums (hidden when none) ────── */}
      <TopFinishes achievements={achievements} />

      {/* ── The record: filters + year-grouped timeline ──────────────── */}
      <div className="space-y-6">
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
                className="flex items-center gap-2 px-4 py-2 bg-brand text-white rounded-lg font-semibold text-sm hover:bg-brand-hover transition-colors shadow-sm"
              >
                <Plus className="w-4 h-4" />
                Add Achievement
              </button>
            ) : undefined
          }
        >
          <MultiSelectDropdown<string>
            allLabel="All Sports"
            itemNounPlural="sports"
            searchPlaceholder="Search sports..."
            options={sportOptions}
            selected={selectedSports}
            onChange={setSelectedSports}
            disabled={sportOptions.length === 0}
          />
          <MultiSelectDropdown<number>
            allLabel="All Years"
            itemNounPlural="years"
            searchPlaceholder="Search years..."
            options={yearOptions.map(year => ({ value: year, label: String(year) }))}
            selected={selectedYears}
            onChange={setSelectedYears}
            disabled={yearOptions.length === 0}
          />
        </FilterBar>

        {!hasAny && (
          <SectionEmptyState
            icon={Trophy}
            title="No achievements yet"
            body={
              isOwnProfile
                ? 'Add your awards, titles, and milestones to build your athletic résumé over the years.'
                : "This athlete hasn't added achievements yet."
            }
            cta={isOwnProfile ? { label: 'Add Your First Achievement', onClick: openAdd } : undefined}
          />
        )}

        {hasAny && visible.length === 0 && (
          <div className="text-center py-10 px-4 border border-dashed border-border rounded-lg">
            <p className="text-sm text-muted">No achievements match your filters.</p>
          </div>
        )}

        {visible.length > 0 && (
          <YearTimeline
            achievements={visible}
            isOwnProfile={isOwnProfile}
            onEdit={openEdit}
            onDelete={setDeleting}
          />
        )}
      </div>

      <AddAchievementModal
        isOpen={isModalOpen}
        onClose={() => {
          setIsModalOpen(false);
          setEditing(null);
        }}
        onSaved={refetchAchievements}
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
