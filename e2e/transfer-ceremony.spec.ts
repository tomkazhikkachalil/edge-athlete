import { test, expect, request } from '@playwright/test';
import { createHash } from 'crypto';
import { apiAs, readErrorBody, E2E_BASE_URL, loadEnv } from './helpers/qa-user';

// The transfer ceremony (Round 4 hardening): the most complex state machine
// in the app — guardian-initiated handover through contact verification and
// dual confirmation into cooling-off, plus the either-party cancel escape —
// had ZERO committed regression coverage until this spec.
//
// The contact-verification OTP is stored as sha256(`${transferId}:${code}`)
// in guardian_invites, so the spec seeds its OWN row for a known code via
// the service role — no mailbox needed (SMTP is off in local runs anyway).
//
// Flag-gated like guardian-console.spec.ts: green-skips where the feature
// is dark. Serial; afterAll cleanup owns the child.

test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const HANDLE = `eaqa_hand_${stamp}`;
const PIN = '4321';
const KNOWN_CODE = '654321';
let flagOn = true;
let childId = '';
let transferId = '';
let childCtx: Awaited<ReturnType<typeof request.newContext>> | null = null;

function serviceEnv() {
  loadEnv();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return {
    url,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  };
}

test('setup: flag probe, child with credentials, child session', async () => {
  const api = await apiAs('state.json');
  try {
    const probe = await api.post('/api/guardian/athletes', { data: {} });
    if (probe.status() === 404) {
      flagOn = false;
      test.skip(true, 'guardian flag off in this environment');
      return;
    }
    const dob = new Date(Date.UTC(new Date().getUTCFullYear() - 10, 5, 15))
      .toISOString().split('T')[0];
    const res = await api.post('/api/guardian/athletes', {
      data: { first_name: 'Handover', last_name: 'Kid', dob, handle: HANDLE },
    });
    expect(res.status(), await readErrorBody(res)).toBe(201);
    childId = (await res.json()).profileId;

    const cred = await api.post(`/api/guardian/athletes/${childId}/credentials`, {
      data: { mode: 'pin', secret: PIN },
    });
    expect(cred.ok(), await readErrorBody(cred)).toBe(true);

    childCtx = await request.newContext({ baseURL: E2E_BASE_URL });
    const login = await childCtx.post('/api/auth/username-login', {
      data: { username: HANDLE, secret: PIN },
    });
    expect(login.ok(), await readErrorBody(login)).toBe(true);
  } finally {
    await api.dispose();
  }
});

test('guardian initiates; athlete verifies an independent contact', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    const start = await api.post('/api/transfers', { data: { profileId: childId } });
    expect(start.status(), await readErrorBody(start)).toBe(201);
    expect((await start.json()).transfer.state).toBe('initiated');

    const get = await api.get(`/api/transfers?profileId=${childId}`);
    transferId = (await get.json()).transfer.id;
    expect(transferId).toBeTruthy();

    // Athlete submits a contact that is theirs alone.
    const contact = await childCtx!.post(`/api/transfers/${transferId}`, {
      data: { action: 'submit_contact', email: `qa-handover-${stamp}@example.net` },
    });
    expect(contact.ok(), await readErrorBody(contact)).toBe(true);

    // Seed a KNOWN code the same way issueContactOtp stores them.
    const svc = serviceEnv();
    const seeded = await fetch(`${svc.url}/rest/v1/guardian_invites`, {
      method: 'POST',
      headers: svc.headers,
      body: JSON.stringify({
        token_hash: createHash('sha256').update(`${transferId}:${KNOWN_CODE}`).digest('hex'),
        invite_type: 'transfer_contact_verify',
        invited_email: `qa-handover-${stamp}@example.net`,
        profile_id: childId,
        expires_at: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
    });
    expect(seeded.ok, await seeded.text().catch(() => '')).toBe(true);

    // A wrong code must be refused — BEFORE the good one, because success
    // advances the state and later attempts 409 on state, not 400 on code.
    const bad = await childCtx!.post(`/api/transfers/${transferId}`, {
      data: { action: 'verify_contact', code: '000000' },
    });
    expect(bad.status()).toBe(400);

    const verify = await childCtx!.post(`/api/transfers/${transferId}`, {
      data: { action: 'verify_contact', code: KNOWN_CODE },
    });
    expect(verify.ok(), await readErrorBody(verify)).toBe(true);
    expect((await verify.json()).state).toBe('dual_confirm');
  } finally {
    await api.dispose();
  }
});

test('dual confirm: one side is not enough, and the awaited party is notified', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    const guardianConfirm = await api.post(`/api/transfers/${transferId}`, {
      data: { action: 'confirm' },
    });
    expect(guardianConfirm.ok(), await readErrorBody(guardianConfirm)).toBe(true);
    expect((await guardianConfirm.json()).state).toBe('dual_confirm');

    // Round 1 integration: the child (the awaited party) got the bell.
    const bell = await childCtx!.get('/api/notifications');
    const notifs = (await bell.json()).notifications ?? [];
    expect(notifs.some((n: { type: string }) => n.type === 'transfer_update')).toBe(true);

    const athleteConfirm = await childCtx!.post(`/api/transfers/${transferId}`, {
      data: { action: 'confirm', guardianPostRole: 'viewer' },
    });
    expect(athleteConfirm.ok(), await readErrorBody(athleteConfirm)).toBe(true);
    const body = await athleteConfirm.json();
    expect(body.state).toBe('cooling_off');
    expect(body.coolingOffEndsAt).toBeTruthy();
  } finally {
    await api.dispose();
  }
});

test('cooling-off is still cancellable by either party', async () => {
  test.skip(!flagOn, 'guardian flag off');
  const api = await apiAs('state.json');
  try {
    const cancel = await api.post(`/api/transfers/${transferId}`, {
      data: { action: 'cancel' },
    });
    expect(cancel.ok(), await readErrorBody(cancel)).toBe(true);

    // Cancelled is terminal: no active transfer remains.
    const after = await api.get(`/api/transfers?profileId=${childId}`);
    expect((await after.json()).transfer).toBeNull();
  } finally {
    await api.dispose();
  }
});

test.afterAll(async () => {
  if (childCtx) await childCtx.dispose();
  if (!flagOn || !childId) return;
  const api = await apiAs('state.json');
  try {
    const res = await api.delete(`/api/guardian/athletes/${childId}`, {
      data: { confirmHandle: HANDLE },
    });
    if (!res.ok()) {
      console.error('[e2e] transfer-ceremony cleanup failed:', await readErrorBody(res));
    }
  } finally {
    await api.dispose();
  }
});
