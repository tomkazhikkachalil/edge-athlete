'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, Archive, RefreshCw, Dumbbell, ChevronDown } from 'lucide-react';
import OptimizedImage from './OptimizedImage';
import AddEquipmentModal from './AddEquipmentModal';
import ReplaceEquipmentModal from './ReplaceEquipmentModal';
import ConfirmModal from './ConfirmModal';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import { deriveInBagYearOptions, isInBagDuringYear, formatMonthYear, yearOf, matchesSportFilter } from '@/lib/profile-filters';
import { getCategoryConfig, getEquipmentCategories, getSetupLabel } from '@/lib/equipment-config';
import { groupRetiredByYear, countByStatus, EARLIER_BUCKET } from '@/lib/equipment-display';
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
  // Sports whose History group is expanded (collapsed by default).
  const [openHistories, setOpenHistories] = useState<Record<string, boolean>>({});
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

  // One section per sport — a mini profile of that sport's gear: what's in
  // play now (active, grouped by category), then a collapsible year-grouped
  // History of retired gear.
  const bySport = filteredEquipment.reduce((acc, item) => {
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

  return (
    <div className="w-full space-y-6">
      {/* Filters + add button — shared FilterBar treatment */}
      <FilterBar
        resultCount={loading ? undefined : filteredEquipment.length}
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

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredEquipment.length === 0 && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
            <Dumbbell className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {selectedYears.length > 0 || selectedSports.length > 0
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

      {/* One section per sport: Current Setup (active, by category) + History */}
      {!loading && filteredEquipment.length > 0 && (
        <div className="space-y-12">
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
              <section key={sport}>
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
                      return (
                        <div key={category}>
                          <div className="flex items-center gap-3 mb-4">
                            <span className="text-2xl">{config.icon}</span>
                            <h5 className="text-lg font-bold text-gray-900">{config.label}</h5>
                            <span className="text-sm text-gray-500">({categoryItems.length})</span>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                            {categoryItems.map(renderCard)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* History — retired gear, year over year, collapsed by default */}
                {historyBuckets.length > 0 && (
                  <div className="mt-8">
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
                        {historyBuckets.map(bucket => (
                          <div key={String(bucket.year)}>
                            <h5 className="text-lg font-bold text-gray-900 mb-4">
                              {bucket.year === EARLIER_BUCKET ? 'Earlier' : bucket.year}
                            </h5>
                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                              {bucket.items.map(renderCard)}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </section>
            );
          })}
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

// Equipment card component
interface EquipmentCardProps {
  item: EquipmentItem;
  isOwnProfile: boolean;
  onEdit: () => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onReplace: () => void;
}

// "Active since Mar 2024" (active) / "2019 – 2023" or "Mar 2023 – Jun 2023"
// (retired; month detail only within a single year). User dates first,
// server audit timestamps as fallback for legacy rows.
function formatOwnershipSpan(item: EquipmentItem): string | null {
  const acquired = item.acquired_on ?? item.added_at;
  if (!acquired) return null;
  if (item.status === 'active') {
    return `Active since ${formatMonthYear(acquired)}`;
  }
  const retired = item.retired_on ?? item.retired_at;
  if (!retired) return `Active since ${formatMonthYear(acquired)}`;
  const sameYear = yearOf(acquired) === yearOf(retired);
  return sameYear
    ? `${formatMonthYear(acquired)} – ${formatMonthYear(retired)}`
    : `${formatMonthYear(acquired, { yearOnly: true })} – ${formatMonthYear(retired, { yearOnly: true })}`;
}

function EquipmentCard({ item, isOwnProfile, onEdit, onDelete, onToggleStatus, onReplace }: EquipmentCardProps) {
  const config = getCategoryConfig(item.sport_key || 'general', item.category);
  const isActive = item.status === 'active';
  const ownershipSpan = formatOwnershipSpan(item);

  return (
    <div
      className={`relative rounded-lg overflow-hidden transition-all duration-200 ${
        isActive
          ? 'bg-white border-2 border-gray-200 hover:border-violet-400 hover:shadow-lg'
          : 'bg-gray-50 border-2 border-gray-200'
      }`}
    >
      {/* Status badge */}
      <div className="absolute top-3 right-3 z-10">
        {isActive ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-600 text-white text-xs font-bold rounded-full">
            <CheckCircle2 className="w-3 h-3" />
            Active
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-xs font-bold rounded-full">
            <Archive className="w-3 h-3" />
            Retired
          </span>
        )}
      </div>

      {/* Image */}
      <div className={`aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative ${isActive ? '' : 'opacity-75'}`}>
        {item.image_url ? (
          <OptimizedImage
            src={item.image_url}
            alt={`${item.brand} ${item.model}`}
            width={400}
            height={300}
            className="w-full h-full object-contain p-4"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-6xl">{config.icon}</span>
          </div>
        )}
      </div>

      {/* Content. Retired items dim the INFO only — the owner actions
          (Edit/Activate/Delete) keep full contrast, which whole-card
          opacity used to wash out. */}
      <div className="p-4 space-y-3">
        <div className={`space-y-3 ${isActive ? '' : 'opacity-75'}`}>
          {/* Category badge */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`px-2 py-1 rounded-md text-xs font-semibold ${config.color}`}>
              {config.label}
            </span>
          </div>

          {/* Brand & Model */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 leading-tight">{item.brand}</h4>
            <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5">{item.model}</p>
            {ownershipSpan && (
              <p className="text-xs text-gray-500 mt-1">{ownershipSpan}</p>
            )}
          </div>

          {/* Specs */}
          {item.specs && Object.keys(item.specs).length > 0 && (
            <div className="space-y-1">
              {Object.entries(item.specs)
                .filter(([, value]) => value)
                .slice(0, 3) // Show only first 3 specs
                .map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between text-xs">
                    {/* /_/g, not '_': replace() with a string swaps only the
                        FIRST underscore, so a three-word spec key such as
                        batting_glove_size rendered as "Batting glove_size". */}
                    <span className="text-gray-500 capitalize">{key.replace(/_/g, ' ')}</span>
                    <span className="text-gray-900 font-semibold">{value}</span>
                  </div>
                ))}
            </div>
          )}

          {/* Notes preview */}
          {item.notes && (
            <p className="text-xs text-gray-600 line-clamp-2 italic">&quot;{item.notes}&quot;</p>
          )}
        </div>

        {/* Actions (only for own profile) */}
        {isOwnProfile && (
          <div className="space-y-2 pt-2 border-t border-gray-200">
            {/* Primary actions row */}
            <div className="flex items-center gap-2">
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-3 h-3" />
                Edit
              </button>
              <button
                onClick={() => onToggleStatus(item.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] rounded-lg text-xs font-semibold transition-colors ${
                  isActive
                    ? 'bg-gray-100 hover:bg-gray-200 text-gray-700'
                    : 'bg-green-100 hover:bg-green-200 text-green-700'
                }`}
              >
                {isActive ? (
                  <>
                    <Archive className="w-3 h-3" />
                    Retire
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-3 h-3" />
                    Activate
                  </>
                )}
              </button>
              <button
                onClick={() => onDelete(item.id)}
                aria-label="Delete equipment"
                className="px-3 py-2 min-h-[40px] min-w-[40px] flex items-center justify-center bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Replace button (only show for active equipment) */}
            {isActive && (
              <button
                onClick={onReplace}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 min-h-[40px] bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold transition-colors border border-violet-200"
              >
                <RefreshCw className="w-3 h-3" />
                Replace / Upgrade
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
