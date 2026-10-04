import { test, expect } from '@playwright/test';
import { adminClient, apiAs, loadQaUser } from './helpers/qa-user';
import { toWire } from '../src/lib/activities/wire';
import { line } from '../src/lib/activities/__tests__/fixtures';

// After the recording (Live Activities PR 5): the activity page shows the
// segments (tap one → it lights up on the route and the chart), the step
// estimate, the notes and the photos with their pins; the owner edits notes
// and segments in the form and adds / removes photos; the feed card carries
// the extras line.

const T0 = Date.UTC(2026, 9, 2, 9, 0, 0);
const REC = '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f50';

function liveWire() {
  const w = toWire({ format: 'live', type: 'walk', name: 'Park loop', points: line(600, { t0: T0, stepM: 1.4, stepS: 1, climbPerStep: 0.02 }), device: {}, tzOffsetMin: null }, 'America/Toronto');
  return { ...w, recordingId: REC, segments: [{ id: 'climb-1', kind: 'climb', from_s: 120, to_s: 240, label: 'The hill' }] };
}

async function uploadPhoto(api: import('@playwright/test').APIRequestContext): Promise<string> {
  const sharp = (await import('sharp')).default;
  const bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#16a34a' } }).jpeg().toBuffer();
  const intent = await api.post('/api/upload/post-media/intent', { data: { type: 'image/jpeg', size: bytes.length } });
  expect(intent.ok(), await intent.text()).toBe(true);
  const { path, signedUrl } = await intent.json();
  expect((await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': 'image/jpeg' } })).ok()).toBe(true);
  const complete = await api.post('/api/upload/post-media/complete', { data: { path, type: 'image/jpeg' } });
  expect(complete.ok(), await complete.text()).toBe(true);
  return (await complete.json()).url as string;
}

test.beforeAll(async () => {
  const probe = await adminClient().from('activities').select('id, segments').limit(1);
  test.skip(!!probe.error, `migration 251 not applied on this target (${probe.error?.code})`);
});

test('the activity page after a recording: segments light up, steps and notes show, photos pin; the owner edits @mobile', async ({ page }) => {
  test.setTimeout(150_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  let photoUrl: string | null = null;
  let id: string | null = null;
  try {
    const created = await api.post('/api/activities', { data: { activity: liveWire() } });
    expect(created.status(), await created.text()).toBe(201);
    id = (await created.json()).id as string;
    photoUrl = await uploadPhoto(api);
    const attached = await api.post(`/api/activities/${id}/media`, { data: { media_url: photoUrl, media_type: 'image', at_s: 300, caption: 'Top of the hill' } });
    expect(attached.status(), await attached.text()).toBe(201);

    await page.goto(`/activities/${id}`);
    await expect(page.locator('[data-activity-name]')).toHaveText('Park loop', { timeout: 20_000 });
    // Steps (est.), the segments table, the photo and its caption.
    await expect(page.getByText('Steps (est.)')).toBeVisible();
    const segRow = page.locator('[data-activity-segment="climb-1"]');
    await expect(segRow).toBeVisible();
    await expect(segRow).toContainText('The hill');
    await expect(segRow).toContainText('2:00–4:00');
    await expect(page.locator('[data-activity-photos="1"]')).toBeVisible();
    await expect(page.getByText('Top of the hill').first()).toBeVisible();
    const img = page.locator('[data-activity-photo] img').first();
    await expect(img).toBeVisible();
    await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
    // The owner's pin is on the map; tapping the segment draws its span and shades the chart.
    await expect(page.locator('[data-activity-map] .leaflet-marker-icon')).toHaveCount(3, { timeout: 15_000 }); // start, finish, the photo
    const pathsBefore = await page.locator('[data-activity-map] .leaflet-overlay-pane path').count();
    await segRow.click();
    await expect(segRow).toHaveAttribute('aria-selected', 'true');
    await expect.poll(() => page.locator('[data-activity-map] .leaflet-overlay-pane path').count()).toBeGreaterThan(pathsBefore);
    await expect(page.locator('[data-chart-highlight]').first()).toBeVisible();

    // Edit: notes + a second segment through the form.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('[data-activity-notes-input]').fill('Felt strong on the hill.');
    await page.locator('[data-activity-segment-add]').click();
    const rows = page.locator('[data-activity-segment-row]');
    await expect(rows).toHaveCount(2);
    await rows.nth(1).getByLabel('Segment start').fill('7:00');
    await rows.nth(1).getByLabel('Segment end').fill('8:30');
    await rows.nth(1).locator('select').selectOption('sprint');
    await page.locator('[data-activity-edit-save]').click();
    await expect(page.locator('[data-activity-edit-form]')).toHaveCount(0, { timeout: 15_000 });
    await expect(page.locator('[data-activity-notes]')).toHaveText('Felt strong on the hill.');
    await expect(page.locator('[data-activity-segments="2"]')).toBeVisible();
    const { data: row } = await admin.from('activities').select('notes, segments').eq('id', id).single();
    expect(row!.notes).toBe('Felt strong on the hill.');
    expect(row!.segments).toHaveLength(2);
    expect(row!.segments[1]).toMatchObject({ kind: 'sprint', from_s: 420, to_s: 510 });

    // A segment past the end is refused by name, in the form.
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    await page.locator('[data-activity-segment-row]').nth(1).getByLabel('Segment end').fill('99:00');
    await page.locator('[data-activity-edit-save]').click();
    await expect(page.locator('[data-activity-segments-editor] [role="alert"]')).toContainText('cannot end after');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByRole('button', { name: 'Discard', exact: true }).click();

    // Remove the photo.
    await page.locator(`[data-activity-photo-row]`).getByRole('button', { name: 'Remove photo' }).click();
    await page.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(page.locator('[data-activity-photos]')).toHaveCount(0, { timeout: 15_000 });
    expect((await admin.from('activity_media').select('id').eq('activity_id', id)).data).toHaveLength(0);
  } finally {
    if (id) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    if (photoUrl) {
      const key = photoUrl.split('/public/uploads/')[1];
      if (key) await admin.storage.from('uploads').remove([key]).catch(() => undefined);
    }
    await api.dispose();
  }
});

test('the feed card of a shared recording carries the extras line', async ({ page }) => {
  test.setTimeout(120_000);
  const user = loadQaUser('user.json');
  const admin = adminClient();
  const api = await apiAs('state.json');
  await admin.from('activities').delete().eq('profile_id', user.id).eq('source', 'live');
  let id: string | null = null;
  try {
    const created = await api.post('/api/activities', { data: { activity: { ...liveWire(), recordingId: '7d4f9e2a-1b3c-4d5e-8f6a-9b0c1d2e3f51' } } });
    expect(created.status(), await created.text()).toBe(201);
    id = (await created.json()).id as string;
    const shared = await api.post('/api/posts', { data: { postType: 'general', caption: 'Loop', visibility: 'public', stats_data: { type: 'activity', activity_id: id } } });
    expect(shared.status(), await shared.text()).toBeLessThan(300);
    const post = (await shared.json()).post ?? (await shared.json());
    await page.goto(`/activities/${id}`);
    await expect(page.locator('[data-activity-name]')).toBeVisible({ timeout: 20_000 });
    await page.goto('/feed');
    const card = page.locator(`[data-activity-post-card="${id}"]`).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.locator('[data-activity-card-extras]')).toContainText('1 segment');
    await expect(card.locator('[data-activity-card-extras]')).toContainText('steps (est.)');
    void post;
  } finally {
    if (id) await api.delete(`/api/activities/${id}`).catch(() => undefined);
    await api.dispose();
  }
});
