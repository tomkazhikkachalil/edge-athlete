# AI Runner — protocol, self-hosting, and the cost gate

**Status (Aug 2026): scaffold only.** The editor's AI integration is
fully built and tested, but this repo ships **no models, no weights, and
no hosted inference**. Every AI affordance in the editor is invisible
until `NEXT_PUBLIC_AI_RUNNER_URL` is set — and setting it is a deliberate
act with the cost implications below. This is the photo-editor mandate's
one hard stop working as designed.

## What the integration does today

- `src/lib/media/ai/` — the runner contract (`AiRunner`), an HTTP client
  for any endpoint speaking the protocol below (zod-validated; an AI
  endpoint is still untrusted input), and fail-closed resolution from the
  env var.
- **Mask ingestion is a first-class recipe citizen**: a `data` mask kind
  (RLE-encoded binary raster ≤512², feathered on decode, invertible)
  flows through the same engine texture slots, CPU reference, schema, and
  history as brush masks. This works TODAY without any model — it is the
  landing pad.
- Masks tool → **“✦ Select subject”** (visible only with a runner):
  sends the framed image, receives a subject mask, lands it as a `data`
  mask with a soft edge. Invert flips subject ↔ background — combined
  with the mask Blur slider, that is one-tap background defocus.

## Protocol (v1)

A runner is any HTTP server exposing:

### `POST {base}/segment`
- **Request body**: the image bytes (JPEG, ≤512px long edge),
  `Content-Type: image/jpeg`.
- **Response** `200` JSON:
  ```json
  { "width": 512, "height": 384, "rle": "1200,45,467,..." }
  ```
  `rle` = row-major runs of alternating 0s/1s **starting with zeros**,
  comma-joined, over `width × height` bits (see
  `src/lib/media/engine/mask-rle.ts`). Dimensions ≤512; rle ≤20,000
  chars. Anything else (non-200, invalid JSON, undecodable RLE) is
  treated as "no subject found".

Planned, same shape (not yet consumed by the editor):
- `POST {base}/inpaint` — image + mask → healed image bytes.
- `POST {base}/upscale?factor=2|4` — image → enlarged image bytes.

## Hosting options and what they cost

**Local runners are ruled out** (Tom, Aug 25 2026: "production ready at
all times" — nothing user-facing may depend on a machine that can be
off). A `localhost` runner was once listed here as a $0 evaluation path;
it is retired. The only acceptable runners are production-hosted:

| Option | Model | Cost | Notes |
| --- | --- | --- | --- |
| Always-on small VPS (CPU) | MobileSAM | ~$5–20/mo | Seconds-per-image latency; fine for low volume. |
| GPU cloud (serverless or dedicated) | SAM / LaMa / Real-ESRGAN | usage-based, real money | Needed for snappy latency at user scale. |

**Decision rule** (from the mandate): with the free row retired, *every*
way to turn this feature on costs money, so any enablement is a
stop-and-ask. The env var is the switch; the code never decides to
spend.

## Operational notes

- `NEXT_PUBLIC_AI_RUNNER_URL` is inlined at **build** time — setting it
  in Vercel requires a redeploy (same trap as `NEXT_PUBLIC_LOGO_DEV_TOKEN`).
- The runner URL is exposed to clients (it's `NEXT_PUBLIC_`); a hosted
  runner needs its own rate limiting / auth before production use — treat
  that as part of the "costs money" conversation, not an afterthought.
- Recipes with `data` masks remain valid forever regardless of runner
  availability: the mask raster is persisted in the recipe itself, so an
  edit made with AI help re-renders identically with AI turned off.
