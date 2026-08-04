import { test, expect } from '@playwright/test';
import { readErrorBody } from './helpers/qa-user';

// First real assertion of the suite: env + database reachability. The
// webServer readiness check deliberately pings `/` instead, so a broken
// backend fails HERE with a readable body, not as a server-start timeout.
test('GET /api/health reports ok', async ({ request }) => {
  const response = await request.get('/api/health');
  expect(response.status(), await readErrorBody(response)).toBe(200);
  const body = await response.json();
  expect(body.status).toBe('ok');
  expect(body.database).toBe('ok');
});
