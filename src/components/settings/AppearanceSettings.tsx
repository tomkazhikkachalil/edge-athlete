'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { useTheme } from '@/lib/use-theme';
import {
  DEFAULT_SCHEDULE,
  effectiveMode,
  formatMinutes,
  minutesToTimeValue,
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

// The schedule leads: it is what an account has until it chooses otherwise
// (theme-prefs.ts DEFAULT_MODE). Light and Dark are the two ways to keep one
// theme in place; they stay until the schedule is chosen again.
const options: ModeOption[] = [
  {
    value: 'scheduled',
    label: 'Schedule',
    description: 'Dark in the evening and overnight, light in the day. You choose the hours.',
    icon: 'fa-clock',
    iconColor: 'text-success-fg',
  },
  {
    value: 'off',
    label: 'Light',
    description: 'Light theme, always.',
    icon: 'fa-sun',
    iconColor: 'text-warning-fg',
  },
  {
    value: 'on',
    label: 'Dark',
    description: 'Dark theme, always.',
    icon: 'fa-moon',
    iconColor: 'text-brand-fg',
  },
  {
    value: 'system',
    label: 'Match system',
    description: "Follow your device's appearance setting.",
    icon: 'fa-circle-half-stroke',
    iconColor: 'text-tertiary',
  },
];

type Edge = 'start' | 'end';

export default function AppearanceSettings() {
  const { prefs, ready, savePrefs } = useTheme();
  const { showSuccess, showError } = useToast();
  // A count, not a flag: saves queue (use-theme.ts), so a second can start
  // before the first has finished.
  const [pendingSaves, setPendingSaves] = useState(0);
  const saving = pendingSaves > 0;
  // The hours being typed. A time field used to save on EVERY change and was
  // disabled while saving — typing "21" lost focus after the "2". The typed
  // value now lives here, the field is never disabled, and it is committed
  // when the field is left or a moment after the last change (a phone's
  // time picker never blurs the field when it closes).
  const [draft, setDraft] = useState<Partial<Record<Edge, string>>>({});

  // Until the stored prefs are read (the first effect), nothing is selected —
  // an empty placeholder must not read as "Schedule".
  const mode: ThemeMode | null = ready ? effectiveMode(prefs) : null;
  const schedule = prefs.schedule ?? DEFAULT_SCHEDULE;

  const persist = async (next: Parameters<typeof savePrefs>[0], successMessage: string) => {
    setPendingSaves(n => n + 1);
    const ok = await savePrefs(next);
    setPendingSaves(n => n - 1);
    if (ok) showSuccess('Success', successMessage);
    else showError('Error', 'Failed to save appearance settings');
  };

  const handleModeChange = (newMode: ThemeMode) => {
    if (!ready || newMode === mode || saving) return;
    // The hours ride along in every mode, so the schedule comes back as it was.
    void persist({ ...prefs, mode: newMode }, 'Appearance updated');
  };

  // `leaving`: the field lost focus — an emptied or half-typed value is
  // dropped and the stored hour shows again. While still in the field an
  // unfinished value is left alone (never snapped back mid-typing).
  const commitDraft = (leaving: boolean) => {
    if (draft.start === undefined && draft.end === undefined) return;
    const start = draft.start !== undefined ? timeValueToMinutes(draft.start) : schedule.start;
    const end = draft.end !== undefined ? timeValueToMinutes(draft.end) : schedule.end;
    if (start === null || end === null) {
      if (leaving) setDraft({});
      return;
    }
    if (start === end) {
      if (leaving) {
        setDraft({});
        showError('Error', 'Start and end times must differ');
      }
      return;
    }
    setDraft({});
    if (start === schedule.start && end === schedule.end) return;
    void persist({ ...prefs, schedule: { start, end } }, 'Schedule updated');
  };

  useEffect(() => {
    if (draft.start === undefined && draft.end === undefined) return;
    const id = setTimeout(() => commitDraft(false), 1000);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a debounce keyed on the typed value only; commitDraft is re-created every render
  }, [draft]);

  const timeField = (edge: Edge, label: string) => (
    <label className="block">
      <span className="block text-sm font-medium text-secondary mb-1">{label}</span>
      <input
        type="time"
        value={draft[edge] ?? minutesToTimeValue(schedule[edge])}
        onChange={(e) => setDraft(prev => ({ ...prev, [edge]: e.target.value }))}
        onBlur={() => commitDraft(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="w-full px-3 py-2 bg-surface border border-border-strong rounded-md"
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-primary mb-2">Theme</h3>
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
              aria-pressed={mode === opt.value}
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
            {timeField('start', 'Dark from')}
            {timeField('end', 'Until')}
          </div>
          <p className="text-sm text-muted" data-testid="schedule-summary">
            Dark from {formatMinutes(schedule.start)} to {formatMinutes(schedule.end)}
            {schedule.start > schedule.end ? ', across midnight' : ''}.
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
              You can switch between light and dark any time from the menu in the top bar. That
              keeps the theme you picked until you choose Schedule here again.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
