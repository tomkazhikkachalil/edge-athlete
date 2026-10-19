import { test, expect } from './helpers/test';
import { adminClient, resetRateBucket } from './helpers/qa-user';
import { runnerPublicIps } from './helpers/runner-ip';

// The contact list (flow changes program, item 1 — Oct 19 2026, migration
// 266): a signed-out visitor's notification sign-up and inquiry become
// contact rows through POST /api/contacts — the name, the address, the
// source, the message, the consent and the words agreed to; the honeypot
// stores nothing; an inquiry needs a message; the IP bucket refuses the
// sixth in an hour; the old /api/waitlist door writes the same list.
// Self-skips pre-266. @mobile.

const stamp = Date.now().toString(36);
const CONSENT = 'Also send me Edge Athlete news and offers';

test('contacts API: a sign-up, an inquiry, the honeypot, the limit, the waitlist adapter @mobile', async ({ browser }) => {
  test.setTimeout(120_000);
  const admin = adminClient();
  const probe = await admin.from('contacts').select('id').limit(1);
  test.skip(!!probe.error, `contacts missing — run migration 266 (${probe.error?.message})`);

  // The project's storageState signs every context in — an EMPTY state is the signed-out visitor.
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const request = ctx.request;
  const runnerIps = await runnerPublicIps();
  const resetIp = async () => {
    for (const ip of ['::1', '127.0.0.1', 'unknown', ...runnerIps]) await resetRateBucket(admin, 'contacts', ip);
  };
  await resetIp();
  const emails = [`edgeqa-contact-${stamp}@example.com`, `edgeqa-inquiry-${stamp}@example.com`, `edgeqa-bot-${stamp}@example.com`, `edgeqa-wait-${stamp}@example.com`];

  try {
    // A sign-up with a name and consent: the row keeps the words agreed to.
    let res = await request.post('/api/contacts', { data: { email: emails[0].toUpperCase(), name: 'Pat Tester', source: 'notify_signup', marketingConsent: true, consentText: CONSENT, userType: 'athlete' } });
    expect(res.status(), await res.text()).toBe(201);
    expect((await res.json()).email).toBe(emails[0]);
    let { data: rows } = await admin.from('contacts').select('*').eq('email', emails[0]);
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ name: 'Pat Tester', source: 'notify_signup', marketing_consent: true, consent_text: CONSENT, user_type: 'athlete', message: null });

    // The same address again is still a 201 (the person is told it worked) and a second row (history).
    res = await request.post('/api/contacts', { data: { email: emails[0], source: 'notify_signup' } });
    expect(res.status()).toBe(201);
    ({ data: rows } = await admin.from('contacts').select('id').eq('email', emails[0]));
    expect(rows).toHaveLength(2);

    // An inquiry needs a message; with one it lands with consent false and no consent words.
    res = await request.post('/api/contacts', { data: { email: emails[1], source: 'inquiry', name: 'Q' } });
    expect(res.status()).toBe(400);
    res = await request.post('/api/contacts', { data: { email: emails[1], source: 'inquiry', name: 'Q', message: `Do you have leagues in Ottawa? ${stamp}` } });
    expect(res.status(), await res.text()).toBe(201);
    ({ data: rows } = await admin.from('contacts').select('*').eq('email', emails[1]));
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ source: 'inquiry', marketing_consent: false, consent_text: null });
    expect(rows![0].message).toContain('Ottawa');

    // The honeypot: a bot's "success", nothing stored.
    res = await request.post('/api/contacts', { data: { email: emails[2], source: 'notify_signup', website: 'http://spam' } });
    expect(res.status()).toBe(201);
    ({ data: rows } = await admin.from('contacts').select('id').eq('email', emails[2]));
    expect(rows).toHaveLength(0);

    // The old door still writes the list (the landing popup until A2).
    res = await request.post('/api/waitlist', { data: { email: emails[3], userType: 'Club' } });
    expect(res.status(), await res.text()).toBe(201);
    ({ data: rows } = await admin.from('contacts').select('*').eq('email', emails[3]));
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({ source: 'notify_signup', user_type: 'club', marketing_consent: false });

    // The bucket: 5 an hour per address. Three counted so far (the honeypot, the 400 and the waitlist door never reach it) → two more pass, the sixth is refused.
    for (let i = 0; i < 2; i++) {
      res = await request.post('/api/contacts', { data: { email: emails[0], source: 'notify_signup' } });
      expect(res.status(), `counted call ${4 + i}`).toBe(201);
    }
    res = await request.post('/api/contacts', { data: { email: emails[0], source: 'notify_signup' } });
    expect(res.status()).toBe(429);
  } finally {
    await admin.from('contacts').delete().in('email', emails);
    await admin.from('waitlist').delete().in('email', emails);
    await resetIp();
    for (const ip of ['::1', '127.0.0.1', 'unknown', ...runnerIps]) await resetRateBucket(admin, 'waitlist', ip);
    await ctx.close();
  }
});
