'use client';

import { useEffect, useState } from 'react';
import { X, CalendarDays } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from './Toast';
import type { EquipmentItem } from './EquipmentSection';

interface EditEquipmentDatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  item: EquipmentItem | null;
}

const today = () => new Date().toISOString().split('T')[0];

/**
 * Edit the user-facing equipment dates: "in bag since" (always) and
 * "retired on" (retired items only). These drive the in-bag-during-year
 * filter on the Equipment tab.
 */
export default function EditEquipmentDatesModal({
  isOpen,
  onClose,
  onSaved,
  item,
}: EditEquipmentDatesModalProps) {
  const { showSuccess, showError } = useToast();
  const [acquiredOn, setAcquiredOn] = useState('');
  const [retiredOn, setRetiredOn] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useBodyScrollLock(isOpen);

  useEffect(() => {
    if (!isOpen || !item) return;
    setAcquiredOn(item.acquired_on ?? '');
    setRetiredOn(item.retired_on ?? '');
    setError('');
  }, [isOpen, item]);

  if (!isOpen || !item) return null;

  const isRetired = item.status === 'retired';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;
    if (!acquiredOn) {
      setError('In-bag-since date is required.');
      return;
    }
    if (isRetired && retiredOn && retiredOn < acquiredOn) {
      setError('Retired date must be on or after the in-bag-since date.');
      return;
    }

    setSaving(true);
    setError('');
    try {
      const payload: Record<string, string> = { acquiredOn };
      if (isRetired && retiredOn) payload.retiredOn = retiredOn;

      const response = await fetch(`/api/equipment/${item.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to update dates');
      }
      showSuccess('Success', 'Equipment dates updated');
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update dates';
      setError(message);
      showError('Error', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
              <CalendarDays className="w-5 h-5 text-blue-600" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">Edit Dates</h2>
              <p className="text-sm text-gray-500">
                {item.brand} {item.model}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="edit-acquired-on" className="block text-sm font-semibold text-gray-900 mb-1">
              In bag since <span className="text-red-500">*</span>
            </label>
            <input
              id="edit-acquired-on"
              type="date"
              value={acquiredOn}
              onChange={e => setAcquiredOn(e.target.value)}
              max={today()}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              required
            />
          </div>

          {isRetired && (
            <div>
              <label htmlFor="edit-retired-on" className="block text-sm font-semibold text-gray-900 mb-1">
                Retired on
              </label>
              <input
                id="edit-retired-on"
                type="date"
                value={retiredOn}
                onChange={e => setRetiredOn(e.target.value)}
                min={acquiredOn || undefined}
                max={today()}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
            </div>
          )}

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving && (
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden="true" />
              )}
              Save Dates
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
