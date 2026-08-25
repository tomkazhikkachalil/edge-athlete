# Media Privacy — the bucket flip (PR5, owner-run)

The final step of the media-proxy arc (#297–#300). Once every media surface is
served through `/api/media/<token>` (PR1–PR4), the `uploads` bucket flips from
public to **private** — the moment private user media stops being byte-readable
by URL. This is an **owner-run production step**, like a DB migration: it is not
done by CI or in code, and it must happen in the right order or it breaks images.

## Why it's flip-last and atomic

All sensitive media (post, message, group/round, equipment, cover, workout,
vitals) lives in the single `uploads` bucket, and a bucket's `public` flag is
all-or-nothing. So the flip is one atomic switch, done **after** every
uploads-reading response is proxied. Throughout PR1–4 the bucket stays public:
the proxy reads it fine, raw URLs still work, zero user impact. The flip is the
security milestone — and it is instantly reversible.

## Prerequisites (ALL must be true before flipping)

1. **PR1–PR4 (#297–#300) merged AND deployed to production.** If prod is not
   running the proxy code, flipping the bucket breaks every image on the site.
2. **`MEDIA_PROXY_SECRET` set in Vercel** (Production env, 32+ random bytes,
   e.g. `openssl rand -base64 32`). Without it, token signing throws.
3. **Proxy verified live in prod**: load the feed / a profile as a normal user
   and confirm images render (they now come through `/api/media/…`). Open a
   private post as a non-follower and confirm its image does NOT render.

## The flip

Two equivalent ways — pick one:

- **Supabase dashboard**: Storage → `uploads` bucket → Settings → turn OFF
  "Public bucket" → Save. (`avatars`, `badges` stay public; `consent-evidence`
  stays private.)
- **Storage API** (service role):
  ```bash
  curl -X PUT "$NEXT_PUBLIC_SUPABASE_URL/storage/v1/bucket/uploads" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Content-Type: application/json" \
    -d '{"public": false}'
  ```

No objects move; only the bucket flag changes. Existing stored URLs remain full
public URLs in the DB (normalize-on-read), which is why the storage-sweep,
post-delete, and account-deletion strippers need no changes.

## Verify (immediately after)

```bash
node scripts/verify-media-privacy.mjs
```
Expected: `uploads` PRIVATE, avatars/badges public, and a real stored uploads
object's raw public URL returns **400/404** (bytes no longer anonymously
fetchable). Also spot-check in a browser: authorized users still see images
(via the proxy); a logged-out visitor sees a private profile's media as broken.

## Rollback (instant)

If anything is wrong, flip the bucket back to public (same dashboard toggle or
`{"public": true}`). The proxy works against a public bucket too, so raw URLs
and the proxy both resume immediately — no data was touched.

## After the flip

- New uploads keep landing in `uploads` (now private) via the existing upload
  routes; `getPublicUrl` still string-builds the stored value, which the read
  layer normalizes to a proxy path. No upload-code change needed.
- Image optimization for proxied media is intentionally off for now (the Next
  optimizer has no viewer cookie); revisit as a perf follow-up.
- Secret rotation, if ever needed: set `MEDIA_PROXY_SECRET_PREVIOUS` to the old
  value, `MEDIA_PROXY_SECRET` to the new one; old cached URLs 403 on next load
  and clients refetch fresh tokens. Remove `_PREVIOUS` after the window.
