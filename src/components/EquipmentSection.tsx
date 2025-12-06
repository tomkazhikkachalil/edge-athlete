'use client';

import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, Archive, RefreshCw } from 'lucide-react';
import OptimizedImage from './OptimizedImage';
import AddEquipmentModal from './AddEquipmentModal';
import ReplaceEquipmentModal from './ReplaceEquipmentModal';
import { useToast } from './Toast';

// Equipment types for different sports
export type EquipmentCategory =
  | 'driver'
  | 'fairway_wood'
  | 'hybrid'
  | 'iron_set'
  | 'wedge'
  | 'putter'
  | 'ball'
  | 'shoes'
  | 'glove'
  | 'bag'
  | 'rangefinder'
  | 'other';

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
  notes?: string;
  created_at: string;
  updated_at: string;
}

interface EquipmentSectionProps {
  profileId: string;
  isOwnProfile?: boolean;
}

// Category display configuration
const CATEGORY_CONFIG: Record<EquipmentCategory, { label: string; icon: string; color: string }> = {
  driver: { label: 'Driver', icon: '🏌️', color: 'bg-blue-100 text-blue-700' },
  fairway_wood: { label: 'Fairway Wood', icon: '🌲', color: 'bg-green-100 text-green-700' },
  hybrid: { label: 'Hybrid', icon: '⚡', color: 'bg-purple-100 text-purple-700' },
  iron_set: { label: 'Iron Set', icon: '⛳', color: 'bg-gray-100 text-gray-700' },
  wedge: { label: 'Wedge', icon: '🎯', color: 'bg-orange-100 text-orange-700' },
  putter: { label: 'Putter', icon: '⛳', color: 'bg-indigo-100 text-indigo-700' },
  ball: { label: 'Ball', icon: '⚪', color: 'bg-white text-gray-700 border border-gray-300' },
  shoes: { label: 'Shoes', icon: '👟', color: 'bg-red-100 text-red-700' },
  glove: { label: 'Glove', icon: '🧤', color: 'bg-yellow-100 text-yellow-700' },
  bag: { label: 'Bag', icon: '🎒', color: 'bg-teal-100 text-teal-700' },
  rangefinder: { label: 'Rangefinder', icon: '📏', color: 'bg-cyan-100 text-cyan-700' },
  other: { label: 'Other', icon: '🔧', color: 'bg-gray-100 text-gray-700' },
};

export default function EquipmentSection({ profileId, isOwnProfile = false }: EquipmentSectionProps) {
  const { showSuccess, showError } = useToast();
  const [equipment, setEquipment] = useState<EquipmentItem[]>([]);
  const [filter, setFilter] = useState<'all' | 'active' | 'retired'>('active');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isReplaceModalOpen, setIsReplaceModalOpen] = useState(false);
  const [equipmentToReplace, setEquipmentToReplace] = useState<EquipmentItem | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch equipment on mount
  useEffect(() => {
    fetchEquipment();
  }, [profileId]);

  const fetchEquipment = async () => {
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
    } catch (error) {
      console.error('Error fetching equipment:', error);
      setEquipment([]);
    } finally {
      setLoading(false);
    }
  };

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

      // Update local state
      setEquipment(prev =>
        prev.map(e => (e.id === id ? { ...e, status: newStatus } : e))
      );

      showSuccess(
        'Success',
        `Equipment ${newStatus === 'active' ? 'activated' : 'retired'} successfully`
      );
    } catch (error) {
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
    } catch (error) {
      showError('Error', 'Failed to delete equipment');
    }
  };

  const handleReplace = (item: EquipmentItem) => {
    setEquipmentToReplace(item);
    setIsReplaceModalOpen(true);
  };

  // Filter equipment based on status
  const filteredEquipment = equipment.filter(item => {
    if (filter === 'all') return true;
    return item.status === filter;
  });

  // Group equipment by category
  const groupedEquipment = filteredEquipment.reduce((acc, item) => {
    const category = item.category;
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(item);
    return acc;
  }, {} as Record<EquipmentCategory, EquipmentItem[]>);

  return (
    <div className="w-full space-y-6">
      {/* Header with filters and add button */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        {/* Status filter pills */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setFilter('active')}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              filter === 'active'
                ? 'bg-green-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <CheckCircle2 className="w-4 h-4 inline-block mr-2" />
            Active ({equipment.filter(e => e.status === 'active').length})
          </button>
          <button
            onClick={() => setFilter('retired')}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              filter === 'retired'
                ? 'bg-gray-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            <Archive className="w-4 h-4 inline-block mr-2" />
            Retired ({equipment.filter(e => e.status === 'retired').length})
          </button>
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg font-semibold text-sm transition-all ${
              filter === 'all'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            All ({equipment.length})
          </button>
        </div>

        {/* Add equipment button (only for own profile) */}
        {isOwnProfile && (
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold text-sm hover:bg-blue-700 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            Add Equipment
          </button>
        )}
      </div>

      {/* Loading state */}
      {loading && (
        <div className="flex justify-center items-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      )}

      {/* Empty state */}
      {!loading && filteredEquipment.length === 0 && (
        <div className="text-center py-16 px-4">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-gray-100 flex items-center justify-center">
            <Dumbbell className="w-10 h-10 text-gray-400" />
          </div>
          <h3 className="text-xl font-bold text-gray-900 mb-2">
            {filter === 'active' && 'No active equipment'}
            {filter === 'retired' && 'No retired equipment'}
            {filter === 'all' && 'No equipment added'}
          </h3>
          <p className="text-gray-600 mb-6 max-w-md mx-auto">
            {isOwnProfile
              ? `Add your golf equipment to showcase your setup and track gear changes over time.`
              : 'This athlete hasn\'t added their equipment yet.'}
          </p>
          {isOwnProfile && (
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plus className="w-5 h-5" />
              Add Your First Item
            </button>
          )}
        </div>
      )}

      {/* Equipment grid - grouped by category */}
      {!loading && filteredEquipment.length > 0 && (
        <div className="space-y-8">
          {Object.entries(groupedEquipment)
            .sort(([a], [b]) => {
              // Sort categories in a logical order
              const order: EquipmentCategory[] = [
                'driver',
                'fairway_wood',
                'hybrid',
                'iron_set',
                'wedge',
                'putter',
                'ball',
                'shoes',
                'glove',
                'bag',
                'rangefinder',
                'other',
              ];
              return order.indexOf(a as EquipmentCategory) - order.indexOf(b as EquipmentCategory);
            })
            .map(([category, items]) => {
              const config = CATEGORY_CONFIG[category as EquipmentCategory];
              return (
                <div key={category}>
                  {/* Category header */}
                  <div className="flex items-center gap-3 mb-4">
                    <span className="text-2xl">{config.icon}</span>
                    <h3 className="text-lg font-bold text-gray-900">{config.label}</h3>
                    <span className="text-sm text-gray-500">({items.length})</span>
                  </div>

                  {/* Equipment cards grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                    {items.map((item) => (
                      <EquipmentCard
                        key={item.id}
                        item={item}
                        isOwnProfile={isOwnProfile}
                        onEdit={(id) => console.log('Edit', id)} // TODO: Implement edit modal
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
    </div>
  );
}

// Equipment card component
interface EquipmentCardProps {
  item: EquipmentItem;
  isOwnProfile: boolean;
  onEdit: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleStatus: (id: string) => void;
  onReplace: () => void;
}

function EquipmentCard({ item, isOwnProfile, onEdit, onDelete, onToggleStatus, onReplace }: EquipmentCardProps) {
  const config = CATEGORY_CONFIG[item.category];
  const isActive = item.status === 'active';

  return (
    <div
      className={`relative rounded-xl overflow-hidden transition-all duration-200 ${
        isActive
          ? 'bg-white border-2 border-gray-200 hover:border-blue-400 hover:shadow-lg'
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
        {/* Category badge */}
        <div className="flex items-center gap-2">
          <span className={`px-2 py-1 rounded-md text-xs font-semibold ${config.color}`}>
            {config.label}
          </span>
        </div>

        {/* Brand & Model */}
        <div>
          <h4 className="text-sm font-semibold text-gray-900 leading-tight">{item.brand}</h4>
          <p className="text-lg font-bold text-gray-900 leading-tight mt-0.5">{item.model}</p>
        </div>

        {/* Specs */}
        {item.specs && Object.keys(item.specs).length > 0 && (
          <div className="space-y-1">
            {Object.entries(item.specs)
              .filter(([, value]) => value)
              .slice(0, 3) // Show only first 3 specs
              .map(([key, value]) => (
                <div key={key} className="flex items-center justify-between text-xs">
                  <span className="text-gray-500 capitalize">{key.replace('_', ' ')}</span>
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
                onClick={() => onEdit(item.id)}
                className="flex-1 flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-semibold transition-colors"
              >
                <Edit2 className="w-3 h-3" />
                Edit
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
                className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg text-xs font-semibold transition-colors border border-blue-200"
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

// Import Dumbbell icon
import { Dumbbell } from 'lucide-react';
