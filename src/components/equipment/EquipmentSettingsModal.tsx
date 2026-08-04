'use client';

import { useState } from 'react';
import { X, ArrowUp, ArrowDown } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { useDirtyClose } from '@/hooks/useDirtyClose';
import { COPY } from '@/lib/copy';
import { useToast } from '../Toast';
import {
  sanitizeEquipmentPrefs, orderSportKeys,
  type EquipmentPrefs, type EquipmentCardDetail,
} from '@/lib/equipment-prefs';
import type { EquipmentView } from '@/lib/equipment-display';

/**
 * The Equipment tab's own settings — organization without a trip to main
 * Settings. Sport display order, defaults (sort + opening season),
 * visibility to others (History / whole sports), and card detail.
 *
 * Mount a FRESH instance per open (conditional render) — all state seeds
 * via useState initializers from the current prefs, the AddEquipmentModal
 * seeding pattern. House modal shape: max-h-modal flex column, scrolling
 * body, pinned footer; every close path goes through useDirtyClose.
 */

interface EquipmentSettingsModalProps {
  currentPrefs: EquipmentPrefs;
  /** Sports that actually have gear, with display labels. */
  sports: Array<{ key: string; label: string }>;
  years: number[];
  onClose: () => void;
  /** Called with the saved prefs; caller refetches/applies. */
  onSaved: (prefs: EquipmentPrefs) => void;
}

export default function EquipmentSettingsModal({
  currentPrefs, sports, years, onClose, onSaved,
}: EquipmentSettingsModalProps) {
  const { showError } = useToast();
  const [saving, setSaving] = useState(false);

  const [sportOrder, setSportOrder] = useState<string[]>(() =>
    orderSportKeys(sports.map(s => s.key), currentPrefs)
  );
  const [defaultSort, setDefaultSort] = useState<'newest' | 'brand'>(
    currentPrefs.defaultSort ?? 'newest'
  );
  const [defaultView, setDefaultView] = useState<EquipmentView>(
    currentPrefs.defaultView ?? 'now'
  );
  const [hideHistory, setHideHistory] = useState(currentPrefs.hideHistory ?? false);
  const [hiddenSports, setHiddenSports] = useState<string[]>(
    currentPrefs.hiddenSports ?? []
  );
  const [cardDetail, setCardDetail] = useState<EquipmentCardDetail>(
    currentPrefs.cardDetail ?? 'detailed'
  );

  const draftPrefs = (): EquipmentPrefs =>
    sanitizeEquipmentPrefs({
      sportOrder, defaultSort, defaultView, hideHistory, hiddenSports, cardDetail,
    });

  const isDirty = () =>
    JSON.stringify(draftPrefs()) !==
    JSON.stringify(
      sanitizeEquipmentPrefs({
        sportOrder: orderSportKeys(sports.map(s => s.key), currentPrefs),
        defaultSort: currentPrefs.defaultSort ?? 'newest',
        defaultView: currentPrefs.defaultView ?? 'now',
        hideHistory: currentPrefs.hideHistory ?? false,
        hiddenSports: currentPrefs.hiddenSports ?? [],
        cardDetail: currentPrefs.cardDetail ?? 'detailed',
      })
    );

  const { requestClose, confirmOpen, confirmDiscard, cancelDiscard } =
    useDirtyClose(isDirty, onClose);

  const move = (key: string, delta: -1 | 1) => {
    setSportOrder(prev => {
      const index = prev.indexOf(key);
      const target = index + delta;
      if (index === -1 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const toggleHidden = (key: string) => {
    setHiddenSports(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const response = await fetch('/api/equipment/prefs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(draftPrefs()),
      });
      if (!response.ok) throw new Error('Failed to save settings');
      const data = await response.json();
      onSaved(data.prefs ?? draftPrefs());
      // Successful save closes directly — never the discard prompt.
      onClose();
    } catch (e) {
      console.error('Failed to save equipment settings:', e);
      showError('Error', 'Failed to save equipment settings');
    } finally {
      setSaving(false);
    }
  };

  const labelFor = (key: string) => sports.find(s => s.key === key)?.label ?? key;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={e => { if (e.target === e.currentTarget) requestClose(); }}
    >
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full max-h-modal flex flex-col">
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Equipment display settings</h2>
          <button
            onClick={requestClose}
            aria-label="Close"
            className="ea-icon-btn inline-flex items-center justify-center"
          >
            <X className="w-5 h-5 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          {/* Sport order */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-1">Sport order</legend>
            <p className="text-xs text-gray-500 mb-3">
              First sport shows first and starts expanded in the side column.
            </p>
            <ul className="space-y-1">
              {sportOrder.map((key, index) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2"
                >
                  <span className="flex-1 min-w-0 truncate text-sm font-medium text-gray-900">
                    {labelFor(key)}
                  </span>
                  <button
                    onClick={() => move(key, -1)}
                    disabled={index === 0}
                    aria-label={`Move ${labelFor(key)} up`}
                    className="ea-interactive flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                  >
                    <ArrowUp className="w-4 h-4 text-gray-600" />
                  </button>
                  <button
                    onClick={() => move(key, 1)}
                    disabled={index === sportOrder.length - 1}
                    aria-label={`Move ${labelFor(key)} down`}
                    className="ea-interactive flex h-8 w-8 items-center justify-center rounded-lg disabled:opacity-30"
                  >
                    <ArrowDown className="w-4 h-4 text-gray-600" />
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>

          {/* Defaults */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-3">Defaults</legend>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Sort</span>
                <select
                  value={defaultSort}
                  onChange={e => setDefaultSort(e.target.value as 'newest' | 'brand')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="newest">Newest</option>
                  <option value="brand">Brand A–Z</option>
                </select>
              </label>
              <label className="block">
                <span className="block text-xs font-medium text-gray-600 mb-1">Opens on</span>
                <select
                  value={String(defaultView)}
                  onChange={e =>
                    setDefaultView(e.target.value === 'now' ? 'now' : Number(e.target.value))
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                >
                  <option value="now">Now</option>
                  {years.map(year => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </label>
            </div>
          </fieldset>

          {/* Visibility */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-1">Visible to others</legend>
            <p className="text-xs text-gray-500 mb-3">
              You always see everything on your own profile.
            </p>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={!hideHistory}
                  onChange={e => setHideHistory(!e.target.checked)}
                  className="accent-violet-600"
                />
                Show my retired gear (History)
              </label>
              {sports.map(sport => (
                <label key={sport.key} className="flex items-center gap-2 text-sm text-gray-700">
                  <input
                    type="checkbox"
                    checked={!hiddenSports.includes(sport.key)}
                    onChange={() => toggleHidden(sport.key)}
                    className="accent-violet-600"
                  />
                  Show my {sport.label} gear
                </label>
              ))}
            </div>
          </fieldset>

          {/* Card detail */}
          <fieldset>
            <legend className="text-sm font-semibold text-gray-900 mb-3">Card detail</legend>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="equipment-card-detail"
                  checked={cardDetail === 'detailed'}
                  onChange={() => setCardDetail('detailed')}
                  className="accent-violet-600"
                />
                Detailed — specs and notes on cards
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="equipment-card-detail"
                  checked={cardDetail === 'compact'}
                  onChange={() => setCardDetail('compact')}
                  className="accent-violet-600"
                />
                Compact — brand, model and dates only
              </label>
            </div>
          </fieldset>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-3 px-4 sm:px-6 py-4 border-t border-gray-200 bg-gray-50">
          <button
            onClick={requestClose}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-violet-600 hover:bg-violet-700 transition-colors disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmOpen}
        title={COPY.FORMS.DISCARD_TITLE}
        message={COPY.FORMS.DISCARD_CONFIRM}
        confirmText={COPY.FORMS.DISCARD_ACTION}
        cancelText="Keep editing"
        onConfirm={confirmDiscard}
        onCancel={cancelDiscard}
        overlayZClass="z-[60]"
      />
    </div>
  );
}
