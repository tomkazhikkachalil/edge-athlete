'use client';

import { useState } from 'react';
import { X, Trophy } from 'lucide-react';
import { useBodyScrollLock } from '@/hooks/useBodyScrollLock';
import { useToast } from './Toast';
import { getAllSports, SPORT_NAMES } from '@/lib/config/sports-config';
import type { Achievement } from '@/lib/achievements';

interface AddAchievementModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** When set, the modal edits this achievement instead of creating one. */
  editing?: Achievement | null;
}

interface FormState {
  title: string;
  sportKey: string; // '' = general (no sport)
  achievedOn: string;
  organization: string;
  placement: string;
  description: string;
}

const today = () => new Date().toISOString().split('T')[0];

const emptyForm = (): FormState => ({
  title: '',
  sportKey: '',
  achievedOn: today(),
  organization: '',
  placement: '',
  description: '',
});

export default function AddAchievementModal({
  isOpen,
  onClose,
  onSaved,
  editing = null,
}: AddAchievementModalProps) {
  const { showSuccess, showError } = useToast();
  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useBodyScrollLock(isOpen);

  // Reset / prefill whenever the modal opens
  // State synchronisation, not a side effect: doing it during render means
  // the previous values never paint for a frame.
  const [syncedOpen, setSyncedOpen] = useState({ isOpen, editing });
  if (
    syncedOpen.isOpen !== isOpen ||
    syncedOpen.editing !== editing
  ) {
    setSyncedOpen({ isOpen, editing });
    // Nested, NOT an early return: this runs in the component body now, so a
    // bare `return` would return undefined from the component.
    if (isOpen) {
      if (editing) {
        setForm({
          title: editing.title,
          sportKey: editing.sport_key ?? '',
          achievedOn: editing.achieved_on,
          organization: editing.organization ?? '',
          placement: editing.placement ?? '',
          description: editing.description ?? '',
        });
      } else {
        setForm(emptyForm());
      }
      setError('');
    }
  }

  if (!isOpen) return null;

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    if (!form.title.trim()) {
      setError('Title is required.');
      return;
    }
    if (!form.achievedOn) {
      setError('Date is required.');
      return;
    }

    setSaving(true);
    setError('');

    try {
      const payload = {
        title: form.title.trim(),
        sportKey: form.sportKey || null,
        achievedOn: form.achievedOn,
        organization: form.organization.trim() || null,
        placement: form.placement.trim() || null,
        description: form.description.trim() || null,
      };

      const response = await fetch(
        editing ? `/api/achievements/${editing.id}` : '/api/achievements',
        {
          method: editing ? 'PATCH' : 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(payload),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw new Error(data?.error || 'Failed to save achievement');
      }

      showSuccess('Success', editing ? 'Achievement updated' : 'Achievement added');
      onSaved();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save achievement';
      setError(message);
      showError('Error', message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center">
              <Trophy className="w-5 h-5 text-amber-600" aria-hidden="true" />
            </div>
            <h2 className="text-xl font-bold text-gray-900">
              {editing ? 'Edit Achievement' : 'Add Achievement'}
            </h2>
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

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label htmlFor="achievement-title" className="block text-sm font-semibold text-gray-900 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="achievement-title"
              type="text"
              value={form.title}
              onChange={e => set('title', e.target.value)}
              maxLength={120}
              placeholder="e.g. Club Championship Winner"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500"
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="achievement-sport" className="block text-sm font-semibold text-gray-900 mb-1">
                Sport
              </label>
              <select
                id="achievement-sport"
                value={form.sportKey}
                onChange={e => set('sportKey', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
              >
                <option value="">General</option>
                {getAllSports().map(key => (
                  <option key={key} value={key}>
                    {SPORT_NAMES[key] ?? key}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="achievement-date" className="block text-sm font-semibold text-gray-900 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                id="achievement-date"
                type="date"
                value={form.achievedOn}
                onChange={e => set('achievedOn', e.target.value)}
                max={today()}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white"
                required
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="achievement-org" className="block text-sm font-semibold text-gray-900 mb-1">
                Organization
              </label>
              <input
                id="achievement-org"
                type="text"
                value={form.organization}
                onChange={e => set('organization', e.target.value)}
                maxLength={120}
                placeholder="e.g. USGA, NCAA"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>

            <div>
              <label htmlFor="achievement-placement" className="block text-sm font-semibold text-gray-900 mb-1">
                Placement
              </label>
              <input
                id="achievement-placement"
                type="text"
                value={form.placement}
                onChange={e => set('placement', e.target.value)}
                maxLength={60}
                placeholder="e.g. 1st Place, Finalist"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
          </div>

          <div>
            <label htmlFor="achievement-description" className="block text-sm font-semibold text-gray-900 mb-1">
              Description
            </label>
            <textarea
              id="achievement-description"
              value={form.description}
              onChange={e => set('description', e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What made this one special?"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
            />
          </div>

          {error && (
            <div className="px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Footer */}
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
              className="inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving && (
                <span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" aria-hidden="true" />
              )}
              {editing ? 'Save Changes' : 'Add Achievement'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
