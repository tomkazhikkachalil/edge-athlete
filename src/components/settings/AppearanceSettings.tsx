'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/lib/use-theme';
import {
  DEFAULT_SCHEDULE,
  formatMinutes,
  isOverrideActive,
  minutesToTimeValue,
  nextTransition,
  timeValueToMinutes,
  type ThemeMode,
} from '@/lib/theme-prefs';

interface ModeOption {
  value: ThemeMode;
  label: string;
  description: string;
  icon: string;
  iconColor: string;
}

const options: ModeOption[] = [
  {
    value: 'off',
    label: 'Off',
    description: 'Light theme, always.',
    icon: 'fa-sun',
    iconColor: 'text-warning-fg',
  },
  {
    value: 'on',
    label: 'On',
    description: 'Dark theme, always.',
    icon: 'fa-moon',
    iconColor: 'text-brand-fg',
  },
  {
    value: 'scheduled',
    label: 'Scheduled',
    description: 'Dark theme between the hours you choose.',
    icon: 'fa-clock',
    iconColor: 'text-success-fg',
  },
  {
    value: 'system',
    label: 'Match system',
    description: "Follow your device's appearance setting.",
    icon: 'fa-circle-half-stroke',
    iconColor: 'text-tertiary',
  },
];

export default function AppearanceSettings() {
  const { prefs, savePrefs } = useTheme();
  const { showSuccess, showError } = useToast();
  const [saving, setSaving] = useState(false);

  const mode: ThemeMode = prefs.mode ?? 'off';
  const schedule = prefs.schedule ?? DEFAULT_SCHEDULE;
  const overrideActive =
    mode === 'scheduled' &&
    prefs.override !== undefined &&
    isOverrideActive(prefs.override, schedule, new Date());

  const persist = async (next: Parameters<typeof savePrefs>[0], successMessage: string) => {
    setSaving(true);
    const ok = await savePrefs(next);
    setSaving(false);
    if (ok) showSuccess('Success', successMessage);
    else showError('Error', 'Failed to save appearance settings');
  };

  const handleModeChange = (newMode: ThemeMode) => {
    if (newMode === mode || saving) return;
    // A deliberate mode change supersedes any manual override
    const next = { ...prefs, mode: newMode };
    delete next.override;
    persist(next, 'Appearance updated');
  };

  const handleScheduleChange = (edge: 'start' | 'end', value: string) => {
    const minutes = timeValueToMinutes(value);
    if (minutes === null || saving) return;
    const nextSchedule = { ...schedule, [edge]: minutes };
    if (nextSchedule.start === nextSchedule.end) {
      showError('Error', 'Start and end times must differ');
      return;
    }
    persist({ ...prefs, schedule: nextSchedule }, 'Schedule updated');
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">Dark Mode</h3>
        <p className="text-tertiary text-sm mb-6">
          Choose how Edge Athlete decides between the light and dark theme. This is saved to your
          account and applies on every device you sign in on.
        </p>

        <div className="space-y-3">
          {options.map((opt) => (
            <button
              key={opt.value}
              onClick={() => handleModeChange(opt.value)}
              disabled={saving}
              className={`w-full text-left p-4 rounded-lg border-2 transition-all disabled:opacity-60 ${
                mode === opt.value
                  ? 'border-brand bg-brand-soft'
                  : 'border-border hover:border-border-strong'
              }`}
            >
              <div className="flex items-start gap-3">
                <div
                  className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
                    mode === opt.value ? 'border-brand bg-brand' : 'border-border-strong'
                  }`}
                >
                  {mode === opt.value && <i className="fas fa-check text-white text-xs"></i>}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <i className={`fas ${opt.icon} ${opt.iconColor}`}></i>
                    <h4 className="font-semibold text-primary">{opt.label}</h4>
                  </div>
                  <p className="text-sm text-tertiary">{opt.description}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {mode === 'scheduled' && (
        <div className="rounded-lg border border-border p-4 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Dark from</span>
              <input
                type="time"
                value={minutesToTimeValue(schedule.start)}
                onChange={(e) => handleScheduleChange('start', e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2 bg-surface border border-border-strong rounded-md"
              />
            </label>
            <label className="block">
              <span className="block text-sm font-medium text-secondary mb-1">Until</span>
              <input
                type="time"
                value={minutesToTimeValue(schedule.end)}
                onChange={(e) => handleScheduleChange('end', e.target.value)}
                disabled={saving}
                className="w-full px-3 py-2 bg-surface border border-border-strong rounded-md"
              />
            </label>
          </div>
          <p className="text-sm text-muted">
            Dark from {formatMinutes(schedule.start)} to {formatMinutes(schedule.end)}
            {schedule.start > schedule.end ? ', across midnight' : ''}.
            {overrideActive && prefs.override && (
              <>
                {' '}
                Manually switched to {prefs.override.theme} until{' '}
                {formatMinutes(
                  nextTransition(schedule, new Date()).getHours() * 60 +
                    nextTransition(schedule, new Date()).getMinutes()
                )}
                .
              </>
            )}
          </p>
        </div>
      )}

      <div className="bg-brand-soft border border-border rounded-lg p-4">
        <div className="flex gap-3">
          <i className="fas fa-info-circle text-brand-fg mt-0.5 shrink-0"></i>
          <div>
            <h4 className="font-medium text-primary mb-1">Note</h4>
            {/* "menu in the top bar" covers both surfaces: the avatar dropdown
                on desktop and the hamburger drawer on mobile. Naming the
                profile menu was wrong on phones, where it does not exist. */}
            <p className="text-sm text-secondary">
              You can flip the theme any time from the menu in the top bar. During a scheduled
              window, a manual switch lasts until the next scheduled change, then the schedule
              resumes.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
