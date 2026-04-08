'use client';

import { useState, useEffect } from 'react';
import {
  VITAL_CATEGORIES,
  VITAL_METRICS_MAP,
  parseTimeToSeconds,
  formatSecondsToDisplay,
} from '@/lib/vitals-config';

interface AddVitalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  categoryKey: string;
  metricKey: string;
  rawValue: string;  // what the user types
  notes: string;
  recordedAt: string;
}

const today = () => new Date().toISOString().split('T')[0];

export default function AddVitalModal({ isOpen, onClose, onSaved }: AddVitalModalProps) {
  const [form, setForm] = useState<FormState>({
    categoryKey: '',
    metricKey: '',
    rawValue: '',
    notes: '',
    recordedAt: today(),
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setForm({ categoryKey: '', metricKey: '', rawValue: '', notes: '', recordedAt: today() });
      setError('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const selectedCategory = VITAL_CATEGORIES.find(c => c.key === form.categoryKey);
  const selectedMetric = form.metricKey ? VITAL_METRICS_MAP[form.metricKey] : null;

  const handleCategoryChange = (key: string) => {
    setForm(prev => ({ ...prev, categoryKey: key, metricKey: '', rawValue: '' }));
    setError('');
  };

  const handleMetricChange = (key: string) => {
    setForm(prev => ({ ...prev, metricKey: key, rawValue: '' }));
    setError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!form.categoryKey) { setError('Please select a category.'); return; }
    if (!form.metricKey) { setError('Please select a metric.'); return; }
    if (!form.rawValue.trim()) { setError('Please enter a value.'); return; }
    if (!form.recordedAt) { setError('Please enter a date.'); return; }

    const metric = VITAL_METRICS_MAP[form.metricKey];
    if (!metric) { setError('Invalid metric selected.'); return; }

    // Parse value
    let numericValue: number | null = null;
    let displayValue: string = form.rawValue.trim();

    if (metric.time_format === 'mm:ss') {
      numericValue = parseTimeToSeconds(form.rawValue);
      if (numericValue === null) {
        setError('Enter time as M:SS (e.g. 4:32 or 22:15).');
        return;
      }
      displayValue = formatSecondsToDisplay(numericValue, 'mm:ss');
    } else if (metric.time_format === 'decimal_seconds') {
      numericValue = parseTimeToSeconds(form.rawValue);
      if (numericValue === null) {
        setError('Enter a decimal number (e.g. 4.95).');
        return;
      }
      displayValue = `${numericValue} sec`;
    } else {
      numericValue = parseFloat(form.rawValue);
      if (isNaN(numericValue)) {
        setError('Enter a valid number.');
        return;
      }
      displayValue = `${numericValue} ${metric.unit}`;
    }

    setSaving(true);
    try {
      const res = await fetch('/api/vitals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric_key: metric.key,
          metric_category: form.categoryKey,
          metric_label: metric.label,
          value: numericValue,
          value_display: displayValue,
          unit: metric.unit,
          notes: form.notes.trim() || null,
          recorded_at: form.recordedAt,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }

      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Add Vital Entry</h2>
            <p className="text-xs text-gray-500 mt-0.5">Each entry is saved permanently as part of your development record.</p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-gray-100 text-gray-500 transition-colors"
          >
            <i className="fas fa-times text-sm"></i>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Category */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Category</label>
            <div className="grid grid-cols-2 gap-2">
              {VITAL_CATEGORIES.map(cat => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => handleCategoryChange(cat.key)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                    form.categoryKey === cat.key
                      ? 'border-violet-500 bg-violet-50 text-violet-700'
                      : 'border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  <i className={`${cat.icon} text-xs`}></i>
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Metric — shown after category selected */}
          {selectedCategory && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Metric</label>
              <select
                value={form.metricKey}
                onChange={e => handleMetricChange(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              >
                <option value="">Select a metric…</option>
                {selectedCategory.metrics.map(m => (
                  <option key={m.key} value={m.key}>{m.label} ({m.unit})</option>
                ))}
              </select>
            </div>
          )}

          {/* Value — shown after metric selected */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                {selectedMetric.label}
                <span className="font-normal text-gray-500 ml-1">({selectedMetric.unit})</span>
              </label>
              <input
                type="text"
                value={form.rawValue}
                onChange={e => { setForm(prev => ({ ...prev, rawValue: e.target.value })); setError(''); }}
                placeholder={selectedMetric.placeholder}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
                autoFocus
              />
              {selectedMetric.time_format === 'mm:ss' && (
                <p className="text-xs text-gray-400 mt-1">Enter as minutes:seconds (e.g. 4:32)</p>
              )}
              {selectedMetric.time_format === 'decimal_seconds' && (
                <p className="text-xs text-gray-400 mt-1">Enter as decimal seconds (e.g. 4.95)</p>
              )}
            </div>
          )}

          {/* Date */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">Date Recorded</label>
              <input
                type="date"
                value={form.recordedAt}
                max={today()}
                onChange={e => setForm(prev => ({ ...prev, recordedAt: e.target.value }))}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <p className="text-xs text-gray-400 mt-1">You can back-date entries to record historical results.</p>
            </div>
          )}

          {/* Notes */}
          {selectedMetric && (
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                Notes <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <textarea
                value={form.notes}
                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                placeholder="e.g. Pre-season combine, fresh legs, indoor track…"
                rows={2}
                className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500 resize-none"
              />
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving || !selectedMetric}
              className="flex-1 px-4 py-2.5 bg-violet-600 text-white rounded-lg text-sm font-semibold hover:bg-violet-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <><i className="fas fa-spinner fa-spin mr-1.5"></i>Saving…</>
              ) : (
                'Save Entry'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
