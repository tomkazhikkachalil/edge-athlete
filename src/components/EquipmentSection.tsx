'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, Archive, RefreshCw, Dumbbell } from 'lucide-react';
import OptimizedImage from './OptimizedImage';
import AddEquipmentModal from './AddEquipmentModal';
import ReplaceEquipmentModal from './ReplaceEquipmentModal';
import EditEquipmentDatesModal from './EditEquipmentDatesModal';
import FilterBar from './filters/FilterBar';
import MultiSelectDropdown from './filters/MultiSelectDropdown';
import { deriveInBagYearOptions, isInBagDuringYear, formatMonthYear, yearOf, matchesSportFilter } from '@/lib/profile-filters';
import { getCategoryConfig, getEquipmentCategories } from '@/lib/equipment-config';
import { SPORT_NAMES } from '@/lib/config/sports-config';
import { useToast } from './Toast';

// Categories are per-sport (see lib/equipment-config) and free text for
// General items — plain string, with display config resolved at render time.
export type EquipmentCategory = string;

function sportLabel(sportKey: string): string {
  if (sportKey === 'general') return 'General';
  return SPORT_NAMES[sportKey] ?? sportKey;
}

export interface EquipmentSpecs {
  loft?: string;
  shaft?: string;
  flex?: string;
  length?: string;
  lie?: string;
  grip?: string;
  [key: string]: string | undefined; // Allow custom specs
}

export interface EquipmentItem {
  id: string;
  sport_key: string;
  category: EquipmentCategory;
  brand: string;
  model: string;
  image_url?: string;
  specs?: EquipmentSpecs;
  status: 'active' | 'retired';
  added_at: string;
  retired_at?: string;
  acquired_on?: string | null;
  retired_on?: string | null;
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface EquipmentSectionProps {
  profileId: string;
  isOwnProfile?: boolean;
}


export default function EquipmentSection({ profileId, isOwnProfile = false }: EquipmentSectionProps) {
  const { showSuccess, showError } = useToast();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'retired'>('active');
  const [selectedSports, setSelectedSports] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<number[]>([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [equipmentToReplace, setEquipmentToReplace] = useState<EquipmentItem | null>(null);
  const [equipmentToEdit, setEquipmentToEdit] = useState<EquipmentItem | null>(null);
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

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this equipment?')) return;

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

  // Filter equipment: status AND sport AND "in bag during any selected year"
  const filteredEquipment = equipment.filter(item => {
    if (filter !== 'all' && item.status !== filter) return false;
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

  // Group by sport, then by category within each sport. Sport headers only
  // render when more than one sport is present in the filtered set.
  const groupedBySport = filteredEquipment.reduce((acc, item) => {
    const sport = item.sport_key || 'general';
    if (!acc[sport]) acc[sport] = {};
    if (!acc[sport][item.category]) acc[sport][item.category] = [];
    acc[sport][item.category].push(item);
    return acc;
  }, {} as Record<string, Record<string, EquipmentItem[]>>);

  const sportGroups = Object.keys(groupedBySport).sort((a, b) =>
    sportLabel(a).localeCompare(sportLabel(b))
  );
  const multiSport = sportGroups.length > 1;

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
        activeCount={selectedSports.length + selectedYears.length + (filter !== 'active' ? 1 : 0)}
        onClearAll={() => {
          setFilter('active');
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
        {/* Status filter */}
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value as 'all' | 'active' | 'retired')}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
          aria-label="Filter by status"
        >
          <option value="active">Active ({equipment.filter(e => e.status === 'active').length})</option>
          <option value="retired">Retired ({equipment.filter(e => e.status === 'retired').length})</option>
          <option value="all">All ({equipment.length})</option>
        </select>

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
            {selectedYears.length > 0 || selectedSports.length > 0 ? (
              'No equipment matches your filters'
            ) : (
              <>
                {filter === 'active' && 'No active equipment'}
                {filter === 'retired' && 'No retired equipment'}
                {filter === 'all' && 'No equipment added'}
              </>
            )}
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

      {/* Equipment grid — grouped by sport, then category */}
      {!loading && filteredEquipment.length > 0 && (
        <div className="space-y-10">
          {sportGroups.map(sport => {
            const categories = categoryOrder(sport, Object.keys(groupedBySport[sport]));
            return (
              <div key={sport}>
                {/* Sport header — only when gear spans multiple sports */}
                {multiSport && (
                  <h3 className="text-xl font-bold text-gray-900 mb-4 pb-2 border-b border-gray-200">
                    {sportLabel(sport)}
                  </h3>
                )}

                <div className="space-y-8">
                  {categories.map(category => {
                    const items = groupedBySport[sport][category];
                    const config = getCategoryConfig(sport, category);
                    return (
                      <div key={category}>
                        {/* Category header */}
                        <div className="flex items-center gap-3 mb-4">
                          <span className="text-2xl">{config.icon}</span>
                          <h4 className="text-lg font-bold text-gray-900">{config.label}</h4>
                          <span className="text-sm text-gray-500">({items.length})</span>
                        </div>

                        {/* Equipment cards grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                          {items.map((item) => (
                            <EquipmentCard
                              key={item.id}
                              item={item}
                              isOwnProfile={isOwnProfile}
                              showSportChip={multiSport}
                              onEdit={() => setEquipmentToEdit(item)}
                              onDelete={handleDelete}
                              onToggleStatus={handleToggleStatus}
                              onReplace={() => handleReplace(item)}
                            />
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
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

      {/* Edit Dates Modal */}
      <EditEquipmentDatesModal
        isOpen={equipmentToEdit !== null}
        onClose={() => setEquipmentToEdit(null)}
        onSaved={fetchEquipment}
        item={equipmentToEdit}
      />
    </div>
  );
}

// Equipment card component
interface EquipmentCardProps {
  item: EquipmentItem;
  isOwnProfile: boolean;
  /** Show a sport chip next to the category (when gear spans sports). */
  showSportChip?: boolean;
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

function EquipmentCard({ item, isOwnProfile, showSportChip = false, onEdit, onDelete, onToggleStatus, onReplace }: EquipmentCardProps) {
  const config = getCategoryConfig(item.sport_key || 'general', item.category);
  const isActive = item.status === 'active';
  const ownershipSpan = formatOwnershipSpan(item);

  return (
    <div
      className={`relative rounded-xl overflow-hidden transition-all duration-200 ${
        isActive
          ? 'bg-white border-2 border-gray-200 hover:border-violet-400 hover:shadow-lg'
          : 'bg-gray-50 border-2 border-gray-200 opacity-75 hover:opacity-100'
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
      <div className="aspect-video bg-gradient-to-br from-gray-100 to-gray-200 relative">
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

      {/* Content */}
      <div className="p-4 space-y-3">
        {/* Category (+ sport) badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`px-2 py-1 rounded-md text-xs font-semibold ${config.color}`}>
            {config.label}
          </span>
          {showSportChip && (
            <span className="px-2 py-1 rounded-md text-xs font-semibold bg-violet-50 text-violet-700">
              {sportLabel(item.sport_key || 'general')}
            </span>
          )}
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

        {/* Actions (only for own profile) */}
        {isOwnProfile && (
          <div className="space-y-2 pt-2 border-t border-gray-200">
            {/* Primary actions row */}
            <div className="flex items-center gap-2">
              <button
                onClick={onEdit}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-3 h-3" />
                Edit Dates
              </button>
              <button
                onClick={() => onToggleStatus(item.id)}
                className={`flex-1 flex items-center justify-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
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
                className="px-3 py-2 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-xs font-semibold transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>

            {/* Replace button (only show for active equipment) */}
            {isActive && (
              <button
                onClick={onReplace}
                className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-violet-50 hover:bg-violet-100 text-violet-700 rounded-lg text-xs font-semibold transition-colors border border-violet-200"
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
