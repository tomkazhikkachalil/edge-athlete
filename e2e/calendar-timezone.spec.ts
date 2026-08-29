import { test, expect } from '@playwright/test';
import { apiAs, readErrorBody } from './helpers/qa-user';
import { zonedWallClockToUtc, wallClockInZone } from '../src/lib/calendar/recurrence';

// Venue-anchored timezones (calendar round, PR 1): a 7:00 PM game entered in
// America/Denver is stored as that instant, positions viewer-local on the
// grid, and carries a "· 7:00 PM MDT" venue suffix wherever zones differ.
// Series zones are immutable (the cron re-anchors stepping on the stored
// zone). The UI half runs with a pinned viewer zone so assertions never
// depend on the machine running the suite.

test.describe.configure({ mode: 'serial' });

const DENVER = 'America/Denver';
const stamp = Date.now().toString(36);
let eventId = '';
let seriesEventId = '';
let denverWall: { y: number; m: number; d: number };

/** Tomorrow's date in Denver, as wall parts — DST-proof via the app's solver. */
function tomorrowInDenver() {
  const w = wallClockInZone(Date.now() + 86_400_000, DENVER);
  return { y: w.y, m: w.m, d: w.d };
}

/** Denver's short zone name (MDT vs MST) at the event instant. */
function denverShortName(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DENVER, hour: 'numeric', timeZoneName: 'short',
  }).formatToParts(new Date(ms));
  return parts.find(p => p.type === 'timeZoneName')?.value ?? 'MDT';
}

test('setup: create a 7:00 PM Denver event; zone round-trips through the API', async () => {
  const api = await apiAs('state.json');
  try {
    denverWall = tomorrowInDenver();
    const startMs = zonedWallClockToUtc(denverWall.y, denverWall.m, denverWall.d, 19, 0, DENVER);
    const res = await api.post('/api/calendar/events', {
      data: {
        title: `QA tz venue ${stamp}`,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(startMs + 3_600_000).toISOString(),
        timezone: DENVER,
      },
    });
    test.skip(res.status() === 404, 'calendar flag off');
    expect(res.ok(), await readErrorBody(res)).toBe(true);
    eventId = (await res.json()).event?.id;
    expect(eventId).toBeTruthy();

    // The list read hands the zone back verbatim; the stored instant is the
    // Denver wall clock, not the server's.
    const from = new Date(startMs - 86_400_000).toISOString();
    const to = new Date(startMs + 86_400_000).toISOString();
    const list = await api.get(`/api/calendar/events?from=${from}&to=${to}`);
    expect(list.ok()).toBe(true);
    const mine = ((await list.json()).events as {
      id: string; timezone: string; starts_at: string;
    }[]).find(e => e.id === eventId);
    expect(mine?.timezone).toBe(DENVER);
    expect(wallClockInZone(Date.parse(mine!.starts_at), DENVER).hh).toBe(19);
  } finally {
    await api.dispose();
  }
});

test('single events may change zone; series zones are immutable (400)', async () => {
  test.skip(!eventId, 'setup skipped');
  const api = await apiAs('state.json');
  try {
    // Single event: re-zoning is allowed (a rescheduled venue).
    const rezone = await api.patch(`/api/calendar/events/${eventId}`, {
      data: { scope: 'this', timezone: 'America/Los_Angeles' },
    });
    expect(rezone.ok(), await readErrorBody(rezone)).toBe(true);
    const back = await api.patch(`/api/calendar/events/${eventId}`, {
      data: { scope: 'this', timezone: DENVER },
    });
    expect(back.ok()).toBe(true);

    // Series: the zone is pinned at creation.
    const startMs = zonedWallClockToUtc(denverWall.y, denverWall.m, denverWall.d, 8, 0, DENVER);
    const series = await api.post('/api/calendar/events', {
      data: {
        title: `QA tz series ${stamp}`,
        starts_at: new Date(startMs).toISOString(),
        ends_at: new Date(startMs + 1_800_000).toISOString(),
        timezone: DENVER,
        recurrence: { freq: 'daily', interval: 1, ends: { kind: 'count', count: 3 } },
      },
    });
    expect(series.ok(), await readErrorBody(series)).toBe(true);
    seriesEventId = (await series.json()).event?.id;
    expect(seriesEventId).toBeTruthy();

    const denied = await api.patch(`/api/calendar/events/${seriesEventId}`, {
      data: { scope: 'this', timezone: 'America/New_York' },
    });
    expect(denied.status()).toBe(400);
    expect(((await denied.json()).error as string)).toContain("time zone can't be changed");
  } finally {
    await api.dispose();
  }
});

test.describe('viewer in New York', () => {
  test.use({ timezoneId: 'America/New_York' });

  test('chip shows viewer-local position time plus the venue suffix; detail dual-displays', async ({ page }) => {
    test.skip(!eventId, 'setup skipped');
    // Deep link keys the calendar to the event's month AND opens the modal.
    await page.goto(`/calendar?event=${eventId}`);

    // Detail modal: the venue line ("… in America/Denver").
    await expect(page.getByText(/in America\/Denver/)).toBeVisible();
    await page.getByRole('button', { name: 'Close' }).click();

    // The chip: positioned at 9:00 PM New York, suffixed with Denver time.
    const startMs = zonedWallClockToUtc(denverWall.y, denverWall.m, denverWall.d, 19, 0, DENVER);
    const short = denverShortName(startMs);
    const chip = page.getByRole('button', { name: new RegExp(`QA tz venue ${stamp}`) }).first();
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('9:00 PM');
    await expect(chip).toContainText(`7:00 PM ${short}`);
  });

  test('the form edits in the venue zone and hides the picker on series events @mobile', async ({ page }) => {
    // Self-sufficient: the mobile project is a separate process, so this
    // test cannot lean on the serial setup's ids — it seeds and cleans its
    // own pair.
    const api = await apiAs('state.json');
    let singleId = '';
    let seriesId = '';
    try {
      const wall = tomorrowInDenver();
      const startMs = zonedWallClockToUtc(wall.y, wall.m, wall.d, 19, 0, DENVER);
      const single = await api.post('/api/calendar/events', {
        data: {
          title: `QA tz mobile ${stamp}`,
          starts_at: new Date(startMs).toISOString(),
          ends_at: new Date(startMs + 3_600_000).toISOString(),
          timezone: DENVER,
        },
      });
      test.skip(single.status() === 404, 'calendar flag off');
      expect(single.ok(), await readErrorBody(single)).toBe(true);
      singleId = (await single.json()).event?.id;
      const series = await api.post('/api/calendar/events', {
        data: {
          title: `QA tz mobile series ${stamp}`,
          starts_at: new Date(startMs + 3_600_000).toISOString(),
          ends_at: new Date(startMs + 5_400_000).toISOString(),
          timezone: DENVER,
          recurrence: { freq: 'daily', interval: 1, ends: { kind: 'count', count: 3 } },
        },
      });
      expect(series.ok(), await readErrorBody(series)).toBe(true);
      seriesId = (await series.json()).event?.id;

      // Single event: wall clock renders as typed at the venue (19:00, not
      // the viewer's 21:00), and the zone affordance names the venue zone.
      await page.goto(`/calendar?event=${singleId}`);
      await page.getByRole('button', { name: 'Edit event' }).click();
      await expect(page.locator('#ev-start')).toHaveValue('19:00');
      const tzButton = page.getByRole('button', { name: /change time zone/ });
      await expect(tzButton).toBeVisible();
      await tzButton.click();
      await expect(page.locator('#ev-tz')).toHaveValue(DENVER);

      // Series event: no picker, the immutability copy instead.
      await page.goto(`/calendar?event=${seriesId}`);
      await page.getByRole('button', { name: 'Edit event' }).click();
      await expect(page.getByText(/time zone can.t be changed/)).toBeVisible();
      await expect(page.getByRole('button', { name: /change time zone/ })).toHaveCount(0);
    } finally {
      if (singleId) await api.delete(`/api/calendar/events/${singleId}?scope=this`);
      if (seriesId) await api.delete(`/api/calendar/events/${seriesId}?scope=series`);
      await api.dispose();
    }
  });
});

test('cleanup: delete the QA events', async () => {
  const api = await apiAs('state.json');
  try {
    if (eventId) await api.delete(`/api/calendar/events/${eventId}?scope=this`);
    if (seriesEventId) {
      await api.delete(`/api/calendar/events/${seriesEventId}?scope=series`);
    }
  } finally {
    await api.dispose();
  }
});
