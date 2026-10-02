'use client';

import { useState } from 'react';
import { useToast } from '@/components/Toast';
import Toggle from '@/components/settings/Toggle';
import { useInstallApp } from '@/components/install/InstallAppProvider';
import { usePhoneNotifications } from './usePhoneNotifications';

// ── Settings → Notifications → "On this device" (mig 248) ──────────────────
// The switch for phone notifications and the app icon's number. It is per
// DEVICE (a person may want their phone to buzz and their laptop not to), and
// it says plainly what the phone itself decides: an iPhone only does this in
// the app opened from the home-screen icon, and a "Don't allow" can only be
// undone in the phone's own settings. Hidden entirely when the deployment has
// no keys (no dishonest switch).

export default function PhoneNotificationsSection() {
  const { showError, showSuccess } = useToast();
  const { openGuide } = useInstallApp();
  const phone = usePhoneNotifications();
  const [testing, setTesting] = useState(false);

  if (!phone.ready || !phone.offered) return null;

  const onToggle = async () => {
    if (phone.on) {
      await phone.turnOff();
      return;
    }
    const result = await phone.turnOn();
    if (result === 'denied') {
      showError('Notifications are blocked', 'Allow them for Edge Athlete in your phone’s settings, then try again.');
    } else if (result !== 'on') {
      showError('Could not turn on notifications', 'Please try again in a moment.');
    }
  };

  const sendTest = async () => {
    setTesting(true);
    try {
      const response = await fetch('/api/push/test', { method: 'POST' });
      if (response.ok) showSuccess('Test sent', 'It should arrive in a few seconds.');
      else showError('Could not send a test', 'Please try again in a moment.');
    } catch {
      showError('Could not send a test', 'Check your connection.');
    } finally {
      setTesting(false);
    }
  };

  let detail: React.ReactNode;
  let control: React.ReactNode = null;
  switch (phone.support) {
    case 'needs-install':
      detail = (
        <>
          On iPhone and iPad these work in the Edge Athlete app on your home screen.{' '}
          <button type="button" onClick={openGuide} className="text-brand font-medium underline">
            How to add it
          </button>
        </>
      );
      break;
    case 'denied':
      detail = 'Notifications are blocked for Edge Athlete on this device. Allow them in your phone’s or browser’s settings, then come back here.';
      break;
    case 'unsupported':
      detail = 'This browser can’t show notifications. Open Edge Athlete in Safari, Chrome or Edge, or from the app on your home screen.';
      break;
    default:
      detail = phone.on
        ? 'This device shows new messages and activity, and the app icon shows how many you haven’t seen. Tap one to open it.'
        : 'Get a notification on this device for new messages and activity, with a number on the app icon. Your choices below still apply.';
      control = (
        <Toggle on={phone.on} disabled={phone.busy} onChange={onToggle} label="Phone notifications on this device" />
      );
  }

  return (
    <div className="mb-8" data-push-settings={phone.on ? 'on' : phone.support}>
      <h3 className="text-sm font-semibold text-secondary uppercase tracking-wide mb-3">On this device</h3>
      <div className="border border-border rounded-lg">
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-primary">Phone notifications</p>
            <p className="text-xs text-muted">{detail}</p>
            {phone.on && (
              <button
                type="button"
                onClick={sendTest}
                disabled={testing}
                className="mt-2 text-xs font-medium text-brand underline disabled:opacity-50"
              >
                {testing ? 'Sending…' : 'Send a test notification'}
              </button>
            )}
          </div>
          {control}
        </div>
      </div>
    </div>
  );
}
