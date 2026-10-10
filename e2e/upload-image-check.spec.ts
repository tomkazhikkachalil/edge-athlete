import { test, expect } from '@playwright/test';
import { apiAs, adminClient } from './helpers/qa-user';

// The server's image check (maintenance pass, Oct 10 2026): an uploaded
// image's bytes must BE the declared image, and its location metadata is
// stripped on the server even when the device's own strip was skipped (here:
// a script PUTs straight to the signed URL, as an old tab or a bot would).
test('an uploaded photo is stored without its GPS; a fake image is refused @smoke', async () => {
  test.setTimeout(90_000);
  const api = await apiAs('state.json');
  const admin = adminClient();
  const stored: string[] = [];
  const direct = async (type: string, bytes: Buffer) => {
    const intent = await api.post('/api/upload/post-media/intent', { data: { type, size: bytes.length } });
    expect(intent.ok(), await intent.text()).toBe(true);
    const { path, signedUrl } = await intent.json();
    expect((await api.put(signedUrl, { data: bytes, headers: { 'Content-Type': type } })).ok()).toBe(true);
    return { path: path as string, complete: await api.post('/api/upload/post-media/complete', { data: { path, type } }) };
  };
  try {
    // A real JPEG with an EXIF segment carrying a GPS marker, inserted after SOI.
    const sharp = (await import('sharp')).default;
    const clean = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#7c3aed' } }).jpeg().toBuffer();
    const payload = Buffer.concat([Buffer.from('Exif\0\0'), Buffer.from('MM\0*\0\0\0\x08'), Buffer.from('EA-GPS-45.4215,-75.6972')]);
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff]), payload]);
    const withGps = Buffer.concat([clean.subarray(0, 2), app1, clean.subarray(2)]);
    expect(withGps.includes('EA-GPS')).toBe(true);

    const ok = await direct('image/jpeg', withGps);
    expect(ok.complete.ok(), await ok.complete.text()).toBe(true);
    const url = (await ok.complete.json()).url as string;
    const key = decodeURIComponent(url.split('/storage/v1/object/public/uploads/')[1] ?? '');
    expect(key).toMatch(/^posts\//);
    stored.push(key);
    const { data: blob, error } = await admin.storage.from('uploads').download(key);
    expect(error).toBeNull();
    const bytes = Buffer.from(await blob!.arrayBuffer());
    expect(bytes.includes('EA-GPS'), 'the GPS marker must not be stored').toBe(false);
    expect(bytes[0] === 0xff && bytes[1] === 0xd8, 'still a JPEG').toBe(true);
    expect((await sharp(bytes).metadata()).width).toBe(8);

    // Bytes that are not the image they claim: refused, and nothing kept.
    const fake = await direct('image/png', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>'));
    expect(fake.complete.status()).toBe(400);
    expect((await fake.complete.json()).error).toMatch(/not the image/i);
    const folder = fake.path.slice(0, fake.path.lastIndexOf('/'));
    const name = fake.path.slice(fake.path.lastIndexOf('/') + 1);
    const { data: left } = await admin.storage.from('uploads').list(folder, { search: name });
    expect((left ?? []).filter(f => f.name === name)).toHaveLength(0);
  } finally {
    if (stored.length) await admin.storage.from('uploads').remove(stored).catch(() => {});
    await api.dispose();
  }
});
