'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Dumbbell, ChevronDown, ChevronRight } from 'lucide-react';
import AddEquipmentModal from './AddEquipmentModal';
import ReplaceEquipmentModal from './ReplaceEquipmentModal';
import ConfirmModal from './ConfirmModal';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import EquipmentCard from './equipment/EquipmentCard';
import EquipmentShelf, { ShelfCard, SHELF_VISIBLE_COUNT } from './equipment/EquipmentShelf';
import EquipmentRail from './equipment/EquipmentRail';
import { deriveInBagYearOptions, isInBagDuringYear, matchesSportFilter } from '@/lib/profile-filters';
import { getCategoryConfig, getEquipmentCategories, getSetupLabel } from '@/lib/equipment-config';
import {
  groupRetiredByYear, countByStatus, EARLIER_BUCKET,
  filterEquipmentBySearch, sortEquipment, type EquipmentSort,
  buildEquipmentNav, equipmentAnchorId,
} from '@/lib/equipment-display';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { useToast } from './Toast';

// Types moved to src/types/equipment.ts (importable from server code);
// re-exported here so existing importers keep compiling.
import type { EquipmentItem } from '@/types/equipment';
export type { EquipmentItem, EquipmentSpecs, EquipmentCategory } from '@/types/equipment';

function sportLabel(sportKey: string): string {
  if (sportKey === 'general') return 'General';
  return SPORT_NAMES[sportKey] ?? sportKey;
}

interface EquipmentSectionProps {
  profileId: string;
  isOwnProfile?: boolean;
}


export default function EquipmentSection({ profileId, isOwnProfile = false }: EquipmentSectionProps) {
  const { showSuccess, showError } = useToast();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<EquipmentSort>('newest');
  // Sports whose History group is expanded (collapsed by default).
  const [openHistories, setOpenHistories] = useState<Record<string, boolean>>({});
  // Shelves toggled from strip to full grid via "See all N" (keyed by anchor).
  const [expandedShelves, setExpandedShelves] = useState<Record<string, boolean>>({});
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [equipmentToReplace, setEquipmentToReplace] = useState<EquipmentItem | null>(null);
  const [equipmentToEdit, setEquipmentToEdit] = useState<EquipmentItem | null>(null);
  const [pendingDelete, setPendingDelete] = useState<EquipmentItem | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchEquipment = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/equipment?profileId=${profileId}`, {
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to fetch equipment');
      }

      const data = await response.json();
      setEquipment(data.equipment || []);
    } catch (err) {
      // Silently handle fetch errors - empty state will be shown
      void err;
      setEquipment([]);
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  // Fetch equipment on mount
  useEffect(() => {
    fetchEquipment();
  }, [fetchEquipment]);

  const handleToggleStatus = async (id: string) => {
    const item = equipment.find(e => e.id === id);
    if (!item) return;

    const newStatus = item.status === 'active' ? 'retired' : 'active';

    try {
      const response = await fetch(`/api/equipment/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ status: newStatus }),
      });

      if (!response.ok) {
        throw new Error('Failed to update equipment');
      }

      // Update local state from the server row (status flip also sets/clears
      // retired_on/retired_at, which the dates line renders)
      const data = await response.json().catch(() => null);
      setEquipment(prev =>
        prev.map(e => (e.id === id ? { ...e, ...(data?.equipment ?? { status: newStatus }) } : e))
      );

      showSuccess(
        'Success',
        `Equipment ${newStatus === 'active' ? 'activated' : 'retired'} successfully`
      );
    } catch (e) {
      console.error('Failed to update equipment status:', e);
      showError('Error', 'Failed to update equipment status');
    }
  };

  // The confirm step is ConfirmModal (see render), not the native confirm()
  // dialog — this was the only unstyled confirm left on the profile.
  const handleDelete = async (id: string) => {
    try {
      const response = await fetch(`/api/equipment/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error('Failed to delete equipment');
      }

      // Remove from local state
      setEquipment(prev => prev.filter(e => e.id !== id));
      showSuccess('Success', 'Equipment deleted successfully');
    } catch (e) {
      console.error('Failed to delete equipment:', e);
      showError('Error', 'Failed to delete equipment');
    }
  };

  const handleReplace = (item: EquipmentItem) => {
    setEquipmentToReplace(item);
    setIsReplaceModalOpen(true);
  };

  // Sport options: sports actually present in this athlete's gear
  const sportOptions = useMemo(() => {
    const keys = Array.from(new Set(equipment.map(item => item.sport_key || 'general')));
    return keys
      .sort((a, b) => sportLabel(a).localeCompare(sportLabel(b)))
      .map(key => ({ value: key, label: sportLabel(key) }));
  }, [equipment]);

  // Year options: every year each item spent in the bag (user dates, with
  // the server audit timestamps as fallback for legacy rows)
  const yearOptions = useMemo(
    () =>
      deriveInBagYearOptions(
        equipment.map(item => ({
          acquiredOn: item.acquired_on ?? item.added_at,
          retiredOn: item.retired_on ?? item.retired_at ?? null,
        }))
      ),
    [equipment]
  );

  // Filter equipment: sport AND "in bag during any selected year". There is
  // deliberately NO status filter anymore — active vs retired is structural
  // (Current Setup vs History per sport), so a select for it was redundant
  // and one more control in a row that wrapped to four lines at 320px.
  const filteredEquipment = equipment.filter(item => {
    if (!matchesSportFilter(item.sport_key || 'general', selectedSports)) return false;
    if (selectedYears.length === 0) return true;
    return selectedYears.some(year =>
      isInBagDuringYear(
        item.acquired_on ?? item.added_at,
        item.retired_on ?? item.retired_at ?? null,
        year
      )
    );
  });

  // Text search applies after the structured filters; a sport section with
  // zero matches disappears entirely.
  const searchedEquipment = filterEquipmentBySearch(
    filteredEquipment,
    search,
    item => getCategoryConfig(item.sport_key || 'general', item.category).label
  );

  // One section per sport — a mini profile of that sport's gear: what's in
  // play now (active, grouped by category), then a collapsible year-grouped
  // History of retired gear.
  const bySport = searchedEquipment.reduce((acc, item) => {
    const sport = item.sport_key || 'general';
    (acc[sport] ??= []).push(item);
    return acc;
  }, {} as Record<string, EquipmentItem[]>);

  const sportGroups = Object.keys(bySport).sort((a, b) =>
    sportLabel(a).localeCompare(sportLabel(b))
  );

  // Category order within a sport: the sport's config order, unknown/free-
  // text categories after, alphabetically.
  const categoryOrder = (sport: string, categories: string[]): string[] => {
    const known = getEquipmentCategories(sport).map(c => c.value);
    return [...categories].sort((a, b) => {
      const ia = known.indexOf(a);
      const ib = known.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });
  };

  // Rail model — built from the same filtered set the sections render, so
  // rail counts always agree with what's on screen.
  const railNav = buildEquipmentNav(searchedEquipment, {
    sortedSportKeys: sportGroups,
    sportLabel,
    categoryLabel: (sport, category) => getCategoryConfig(sport, category).label,
    categoryRank: (sport, category) => {
      const known = getEquipmentCategories(sport).map(c => c.value);
      const idx = known.indexOf(category);
      return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
    },
  });

  const jumpTo = (anchorId: string) => {
    document.getElementById(anchorId)?.scrollIntoView({ behavior: 'smooth' });
  };
  const jumpToHistory = (sportKey: string, anchorId: string) => {
    setOpenHistories(prev => ({ ...prev, [sportKey]: true }));
    // Let the section render open before scrolling to it.
    requestAnimationFrame(() => jumpTo(anchorId));
  };

  return (
    <div className="w-full space-y-6">
      {/* Filters + add button — shared FilterBar treatment */}
      <FilterBar
        resultCount={loading ? undefined : searchedEquipment.length}
        resultNoun="item"
        activeCount={selectedSports.length + selectedYears.length}
        onClearAll={() => {
          setSelectedSports([]);
          setSelectedYears([]);
        }}
        actions={
          isOwnProfile ? (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold text-sm hover:bg-violet-700 transition-colors shadow-sm"
            >
              <Plus className="w-4 h-4" />
              Add Equipment
            </button>
          ) : undefined
        }
      >
        {/* Sport filter — enabled once gear spans more than one sport */}
        <MultiSelectDropdown<string>
          allLabel="All Sports"
          itemNounPlural="sports"
          searchPlaceholder="Search sports..."
          options={sportOptions}
          selected={selectedSports}
          onChange={setSelectedSports}
          disabled={sportOptions.length < 2}
        />

        {/* Year filter — "in bag during year" */}
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

      {/* Search + sort — their own row so the pair always fits one line at
          320px (the input yields via flex-1 min-w-0, the select stays fixed) */}
      {!loading && equipment.length > 0 && (
        <div className="flex items-center gap-3">
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search gear — brand, model, notes…"
            aria-label="Search equipment"
            className="flex-1 min-w-0 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          />
          <select
            value={sort}
            onChange={e => setSort(e.target.value as EquipmentSort)}
            aria-label="Sort equipment"
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
          >
            <option value="newest">Newest</option>
            <option value="brand">Brand A–Z</option>
          </select>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && searchedEquipment.length === 0 && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
            <Dumbbell className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {search.trim()
              ? 'No gear matches'
              : selectedYears.length > 0 || selectedSports.length > 0
                ? 'No equipment matches your filters'
                : 'No equipment added'}
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            {isOwnProfile
              ? `Add your equipment to showcase your setup and track gear changes over time.`
              : 'This athlete hasn\'t added their equipment yet.'}
          </p>
          {isOwnProfile && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Add Your First Item
            </button>
          )}
        </div>
      )}

      {/* Store-browse layout: sticky category rail (lg+) beside the sport
          sections; below lg the rail hides and sections keep the stacked
          mobile flow. */}
      {!loading && searchedEquipment.length > 0 && (
        <div className="lg:flex lg:gap-6 lg:items-start">
          <EquipmentRail nav={railNav} onJump={jumpTo} onJumpHistory={jumpToHistory} />
          <div className="min-w-0 flex-1 space-y-12">
          {sportGroups.map(sport => {
            const items = bySport[sport];
            const counts = countByStatus(items);
            const activeItems = items.filter(i => i.status === 'active');
            const activeByCategory = activeItems.reduce((acc, item) => {
              (acc[item.category] ??= []).push(item);
              return acc;
            }, {} as Record<string, EquipmentItem[]>);
            const categories = categoryOrder(sport, Object.keys(activeByCategory));
            const historyBuckets = groupRetiredByYear(items);
            const historyOpen = openHistories[sport] ?? false;

            const renderCard = (item: EquipmentItem) => (
              <EquipmentCard
                key={item.id}
                item={item}
                isOwnProfile={isOwnProfile}
                onEdit={() => setEquipmentToEdit(item)}
                onDelete={id => setPendingDelete(equipment.find(e => e.id === id) ?? null)}
                onToggleStatus={handleToggleStatus}
                onReplace={() => handleReplace(item)}
              />
            );

            return (
              <section key={sport} id={equipmentAnchorId(sport)} className="scroll-mt-24">
                {/* Sport header — the section IS this sport's gear profile,
                    so it renders even for a single sport. */}
                <div className="flex items-baseline gap-3 mb-4 pb-2 border-b border-gray-200">
                  <h3 className="text-xl font-bold text-gray-900">{sportLabel(sport)}</h3>
                  <span className="text-sm text-gray-500">
                    {counts.active} active{counts.retired > 0 ? ` · ${counts.retired} retired` : ''}
                  </span>
                </div>

                {/* Current setup — sport-appropriate label (golf: "In the Bag") */}
                <h4 className="text-sm font-semibold uppercase tracking-wide text-gray-500 mb-4">
                  {getSetupLabel(sport)}
                </h4>
                {activeItems.length === 0 ? (
                  <p className="text-sm text-gray-500 mb-2">
                    {isOwnProfile
                      ? 'Nothing in your current setup — add gear or re-activate something below.'
                      : 'No current gear listed.'}
                  </p>
                ) : (
                  <div className="space-y-8">
                    {categories.map(category => {
                      const config = getCategoryConfig(sport, category);
                      const categoryItems = activeByCategory[category];
                      const anchorId = equipmentAnchorId(sport, category);
                      const expanded = expandedShelves[anchorId] ?? false;
                      const overflows = categoryItems.length > SHELF_VISIBLE_COUNT;
                      return (
                        <div key={category} id={anchorId} className="scroll-mt-24">
                          <div className="flex items-center gap-3 mb-4">
                            <span className="text-2xl">{config.icon}</span>
                            <h5 className="text-lg font-bold text-gray-900">{config.label}</h5>
                            <span className="text-sm text-gray-500">({categoryItems.length})</span>
                            {overflows && (
                              /* Shelf ⇄ grid toggle is a desktop concern — the
                                 mobile grid always shows everything. */
                              <button
                                onClick={() =>
                                  setExpandedShelves(prev => ({ ...prev, [anchorId]: !expanded }))
                                }
                                className="ea-interactive hidden lg:inline-flex items-center gap-1 ml-auto rounded-lg px-2 py-1 text-sm font-semibold text-violet-600"
                              >
                                {expanded ? 'Collapse' : `See all ${categoryItems.length}`}
                                <ChevronRight
                                  className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                />
                              </button>
                            )}
                          </div>
                          <EquipmentShelf expanded={expanded}>
                            {sortEquipment(categoryItems, sort, () => 0).map(item => (
                              <ShelfCard key={item.id} expanded={expanded}>
                                {renderCard(item)}
                              </ShelfCard>
                            ))}
                          </EquipmentShelf>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* History — retired gear, year over year, collapsed by default */}
                {historyBuckets.length > 0 && (
                  <div className="mt-8 scroll-mt-24" id={`${equipmentAnchorId(sport)}-history`}>
                    <button
                      onClick={() => setOpenHistories(prev => ({ ...prev, [sport]: !historyOpen }))}
                      aria-expanded={historyOpen}
                      className="ea-interactive flex items-center gap-2 rounded-lg px-2 py-2 -mx-2 text-sm font-semibold uppercase tracking-wide text-gray-500"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${historyOpen ? '' : '-rotate-90'}`}
                      />
                      History
                      <span className="normal-case font-normal">({counts.retired} retired)</span>
                    </button>
                    {historyOpen && (
                      <div className="mt-4 space-y-8">
                        {historyBuckets.map(bucket => {
                          const bucketAnchor = `${equipmentAnchorId(sport)}-history-${bucket.year}`;
                          const expanded = expandedShelves[bucketAnchor] ?? false;
                          const overflows = bucket.items.length > SHELF_VISIBLE_COUNT;
                          return (
                            <div key={String(bucket.year)}>
                              <div className="flex items-center gap-3 mb-4">
                                <h5 className="text-lg font-bold text-gray-900">
                                  {bucket.year === EARLIER_BUCKET ? 'Earlier' : bucket.year}
                                </h5>
                                <span className="text-sm text-gray-500">({bucket.items.length})</span>
                                {overflows && (
                                  <button
                                    onClick={() =>
                                      setExpandedShelves(prev => ({ ...prev, [bucketAnchor]: !expanded }))
                                    }
                                    className="ea-interactive hidden lg:inline-flex items-center gap-1 ml-auto rounded-lg px-2 py-1 text-sm font-semibold text-violet-600"
                                  >
                                    {expanded ? 'Collapse' : `See all ${bucket.items.length}`}
                                    <ChevronRight
                                      className={`w-4 h-4 transition-transform ${expanded ? 'rotate-90' : ''}`}
                                    />
                                  </button>
                                )}
                              </div>
                              <EquipmentShelf expanded={expanded}>
                                {sortEquipment(bucket.items, sort, () => 0).map(item => (
                                  <ShelfCard key={item.id} expanded={expanded}>
                                    {renderCard(item)}
                                  </ShelfCard>
                                ))}
                              </EquipmentShelf>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
          </div>
        </div>
      )}

      {/* Add Equipment Modal */}
      <AddEquipmentModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSuccess={fetchEquipment}
        profileId={profileId}
      />

      {/* Replace Equipment Modal */}
      {equipmentToReplace && (
        <ReplaceEquipmentModal
          isOpen={isReplaceModalOpen}
          onClose={() => {
            setIsReplaceModalOpen(false);
            setEquipmentToReplace(null);
          }}
          onSuccess={fetchEquipment}
          profileId={profileId}
          oldEquipment={equipmentToReplace}
        />
      )}

      {/* Edit Equipment Modal — a SECOND, conditional AddEquipmentModal
          instance in edit mode. Conditional mount + key: all of the form's
          state seeds via useState initializers, so a fresh mount per item is
          what guarantees correct seeding (the permanent add instance above
          seeds blanks, which is equally correct for it). This replaced
          EditEquipmentDatesModal — the full editor covers dates too. */}
      {equipmentToEdit && (
        <AddEquipmentModal
          key={equipmentToEdit.id}
          isOpen
          editingItem={equipmentToEdit}
          onClose={() => setEquipmentToEdit(null)}
          onSuccess={fetchEquipment}
          profileId={profileId}
        />
      )}

      {/* Delete confirm */}
      <ConfirmModal
        isOpen={pendingDelete !== null}
        title="Delete this equipment?"
        message={
          pendingDelete
            ? `${pendingDelete.brand} ${pendingDelete.model} will be removed from your gear, including its dates and specs. This can't be undone.`
            : ''
        }
        confirmText="Delete"
        cancelText="Keep it"
        onConfirm={() => {
          if (pendingDelete) handleDelete(pendingDelete.id);
          setPendingDelete(null);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
