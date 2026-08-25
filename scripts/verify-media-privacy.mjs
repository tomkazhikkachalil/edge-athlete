#!/usr/bin/env node
// Verify the media-privacy bucket flip (PR5 of the media-proxy arc).
//
// Reads NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the
// environment (or .env.local) and checks, against the LIVE project:
//   1. the `uploads` bucket is PRIVATE (public=false); avatars/badges public.
//   2. a real stored uploads object is NOT anonymously fetchable by its raw
//      public URL (the byte-layer gate closed).
//
// Run AFTER the flip:  node scripts/verify-media-privacy.mjs
// Before the flip it reports uploads=public and the raw URL 200 — expected.
import { readFileSync } from 'fs';

function loadEnv() {
  for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (process.env[key]) continue;
    try {
      for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
        const m = line.match(/^([A-Z_]+)=(.*)$/);
        if (m && m[1] === key) process.env[key] = m[2].trim();
      }
    } catch { /* no .env.local */ }
  }
}

loadEnv();
const U = process.env.NEXT_PUBLIC_SUPABASE_URL;
const K = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!U || !K) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
  process.exit(2);
}
const authHeaders = { apikey: K, Authorization: 'Bearer ' + K };

let failures = 0;
const ok = (m) => console.log('  \x1b[32m✓\x1b[0m ' + m);
const bad = (m) => { console.log('  \x1b[31m✗\x1b[0m ' + m); failures++; };
const note = (m) => console.log('  \x1b[33m•\x1b[0m ' + m);

async function main() {
  console.log('▸ Bucket visibility');
  const bRes = await fetch(`${U}/storage/v1/bucket`, { headers: authHeaders });
  const buckets = await bRes.json();
  const byName = Object.fromEntries((Array.isArray(buckets) ? buckets : []).map(b => [b.name || b.id, b]));
  const uploads = byName['uploads'];
  if (!uploads) { bad('no `uploads` bucket found'); }
  else if (uploads.public === false) ok('`uploads` is PRIVATE');
  else bad('`uploads` is still PUBLIC — run the flip (see docs/MEDIA_PRIVACY_FLIP.md)');
  for (const pub of ['avatars', 'badges']) {
    if (byName[pub]?.public === true) ok(`\`${pub}\` stays public (expected)`);
    else note(`\`${pub}\` public flag = ${byName[pub]?.public} (expected true)`);
  }

  console.log('▸ Raw-URL death (a real uploads object must NOT be anon-fetchable)');
  // Pick any stored post_media URL in the uploads bucket.
  const pmRes = await fetch(
    `${U}/rest/v1/post_media?select=media_url&media_url=ilike.*%2Fpublic%2Fuploads%2F*&limit=1`,
    { headers: authHeaders }
  );
  const rows = await pmRes.json();
  const sample = Array.isArray(rows) && rows[0]?.media_url;
  if (!sample) {
    note('no stored uploads media_url found to sample — skipping raw-URL check');
  } else {
    // Fetch the raw public URL with NO auth (an anonymous byte request).
    const raw = await fetch(sample, { redirect: 'manual' });
    if (raw.status === 400 || raw.status === 404) ok(`raw public URL is dead (HTTP ${raw.status})`);
    else bad(`raw public URL still served (HTTP ${raw.status}) — bytes are still public`);
  }

  console.log('');
  if (failures) { console.log(`\x1b[31m✗ ${failures} check(s) failed\x1b[0m`); process.exit(1); }
  console.log('\x1b[32m✓ media privacy verified\x1b[0m');
}

main().catch(e => { console.error(e); process.exit(2); });
