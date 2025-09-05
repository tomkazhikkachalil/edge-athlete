'use client';

import { useState } from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import type { AthleteBadge } from '@/lib/supabase';
import LazyImage from './LazyImage';

interface BadgesTabProps {
  badges: AthleteBadge[];
  onSave: (badges: AthleteBadge[]) => void;
  isSubmitting: boolean;
}

export default function BadgesTab({ badges, onSave, isSubmitting }: BadgesTabProps) {
  const [orderedBadges, setOrderedBadges] = useState(badges);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newBadge, setNewBadge] = useState({
    label: '',
    icon_url: '',
    color_token: 'primary',
  });

  const getBadgeColor = (colorToken: string): string => {
    const colors: Record<string, string> = {
      primary: 'bg-blue-100 text-blue-800 border-blue-200',
      purple: 'bg-purple-100 text-purple-800 border-purple-200',
      green: 'bg-green-100 text-green-800 border-green-200',
      red: 'bg-red-100 text-red-800 border-red-200',
      yellow: 'bg-yellow-100 text-yellow-800 border-yellow-200',
      gray: 'bg-gray-100 text-gray-800 border-gray-200',
    };
    
    return colors[colorToken] || colors.primary;
  };

  const handleDragEnd = (result: { destination?: { index: number } | null; source: { index: number } }) => {
    if (!result.destination) return;

    const items = Array.from(orderedBadges);
    const [reorderedItem] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, reorderedItem);

    // Update positions
    const reorderedBadges = items.map((badge, index) => ({
      ...badge,
      position: index + 1,
    }));

    setOrderedBadges(reorderedBadges);
  };

  const addBadge = () => {
    if (!newBadge.label.trim()) return;

    const badge: AthleteBadge = {
      id: `temp-${Date.now()}`,
      profile_id: '',
      label: newBadge.label,
      icon_url: newBadge.icon_url || undefined,
      color_token: newBadge.color_token,
      position: orderedBadges.length + 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    setOrderedBadges([...orderedBadges, badge]);
    setNewBadge({ label: '', icon_url: '', color_token: 'primary' });
    setShowAddForm(false);
  };

  const removeBadge = (badgeId: string) => {
    const filtered = orderedBadges.filter(badge => badge.id !== badgeId);
    const reordered = filtered.map((badge, index) => ({
      ...badge,
      position: index + 1,
    }));
    setOrderedBadges(reordered);
  };

  const handleSave = () => {
    onSave(orderedBadges);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-gray-900">Manage Badges</h3>
        <button
          onClick={() => setShowAddForm(true)}
          className="inline-flex items-center px-3 py-2 border border-transparent text-sm leading-4 font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
        >
          <i className="fas fa-plus mr-2" aria-hidden="true"></i>
          Add Badge
        </button>
      </div>

      {/* Add Badge Form */}
      {showAddForm && (
        <div className="bg-gray-50 p-4 rounded-lg border">
          <h4 className="text-sm font-medium text-gray-900 mb-3">Add New Badge</h4>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Label
              </label>
              <input
                type="text"
                value={newBadge.label}
                onChange={(e) => setNewBadge(prev => ({ ...prev, label: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Badge name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Icon URL (optional)
              </label>
              <input
                type="url"
                value={newBadge.icon_url}
                onChange={(e) => setNewBadge(prev => ({ ...prev, icon_url: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="https://example.com/icon.png"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Color
              </label>
              <select
                value={newBadge.color_token}
                onChange={(e) => setNewBadge(prev => ({ ...prev, color_token: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="primary">Blue</option>
                <option value="purple">Purple</option>
                <option value="green">Green</option>
                <option value="red">Red</option>
                <option value="yellow">Yellow</option>
                <option value="gray">Gray</option>
              </select>
            </div>
            <div className="flex justify-end space-x-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="px-3 py-2 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={addBadge}
                disabled={!newBadge.label.trim()}
                className="px-3 py-2 text-sm text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Badge
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Badges List */}
      {orderedBadges.length > 0 ? (
        <div>
          <p className="text-sm text-gray-600 mb-3">
            Drag and drop to reorder badges. The first 3 will be shown on your profile.
          </p>
          <DragDropContext onDragEnd={handleDragEnd}>
            <Droppable droppableId="badges">
              {(provided) => (
                <div
                  {...provided.droppableProps}
                  ref={provided.innerRef}
                  className="space-y-2"
                >
                  {orderedBadges.map((badge, index) => (
                    <Draggable
                      key={badge.id}
                      draggableId={badge.id}
                      index={index}
                    >
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`flex items-center justify-between p-3 bg-white border rounded-lg ${
                            snapshot.isDragging ? 'shadow-lg' : 'shadow-sm'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <div
                              {...provided.dragHandleProps}
                              className="text-gray-400 hover:text-gray-600 cursor-move"
                            >
                              <i className="fas fa-grip-vertical" aria-hidden="true"></i>
                            </div>
                            <div className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium border ${getBadgeColor(badge.color_token)}`}>
                              {badge.icon_url && (
                                <LazyImage
                                  src={badge.icon_url}
                                  alt={`${badge.label} icon`}
                                  className="w-3 h-3 mr-1"
                                  width={12}
                                  height={12}
                                />
                              )}
                              {badge.label}
                            </div>
                            {index < 3 && (
                              <span className="text-xs text-green-600 font-medium">
                                Shown on profile
                              </span>
                            )}
                          </div>
                          <button
                            onClick={() => removeBadge(badge.id)}
                            className="text-red-500 hover:text-red-700 p-1"
                            aria-label={`Remove ${badge.label} badge`}
                          >
                            <i className="fas fa-trash text-sm" aria-hidden="true"></i>
                          </button>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </DragDropContext>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          <i className="fas fa-award text-4xl text-gray-300 mb-3" aria-hidden="true"></i>
          <p>No badges yet. Add your first badge to get started!</p>
        </div>
      )}

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isSubmitting}
          className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <i className="fas fa-spinner fa-spin mr-2" aria-hidden="true"></i>
              Saving...
            </>
          ) : (
            <>
              <i className="fas fa-save mr-2" aria-hidden="true"></i>
              Save Badge Order
            </>
          )}
        </button>
      </div>
    </div>
  );
}