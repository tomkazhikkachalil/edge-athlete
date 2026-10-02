// ── Phone notifications: the server's keys (mig 248) — SERVER ONLY ──────────
// Web Push identifies the sender to the phone's push service with a VAPID key
// pair (`npx web-push generate-vapid-keys`):
//
//   VAPID_PUBLIC_KEY    the public half — the browser subscribes against it
//                       (handed out by GET /api/push/config, never inlined at
//                       build time, so a rotation needs no rebuild)
//   VAPID_PRIVATE_KEY   the private half — signs every push
//   VAPID_SUBJECT       how the push service reaches the operator:
//                       `mailto:…` or an https URL
//
// FAIL CLOSED: without all three the app offers no "Phone notifications"
// switch and the sweep sends nothing (it still stamps the rows it scans, so
// turning the keys on later never floods a phone with the backlog). Read
// inside the functions, never at module scope — the build and CI run without
// them.
//
// PUSH_MOCK_BASE (e2e only): an endpoint on `push.e2e.invalid` is delivered to
// this local stand-in instead. A production deployment ignores it
// (polar-server.ts's POLAR_MOCK_BASE rule).

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

type Env = Record<string, string | undefined>;

export function vapidConfig(env: Env = process.env): VapidConfig | null {
  const publicKey = env.VAPID_PUBLIC_KEY?.trim();
  const privateKey = env.VAPID_PRIVATE_KEY?.trim();
  const subject = env.VAPID_SUBJECT?.trim();
  if (!publicKey || !privateKey || !subject) return null;
  // A P-256 public key is 65 bytes (87 base64url chars); the private 32 (43).
  if (!/^[A-Za-z0-9_-]{80,100}$/.test(publicKey) || !/^[A-Za-z0-9_-]{40,50}$/.test(privateKey)) return null;
  if (!/^(mailto:\S+@\S+|https:\/\/\S+)$/.test(subject)) return null;
  return { publicKey, privateKey, subject };
}

/** Whether this deployment can send — what the config route answers. */
export function pushReady(env: Env = process.env): boolean {
  return vapidConfig(env) !== null;
}

export const PUSH_MOCK_HOST = 'push.e2e.invalid';

/** Where a request for `endpoint` really goes: the endpoint itself, or the
 *  local e2e stand-in for a `push.e2e.invalid` endpoint outside production. */
export function deliveryUrl(endpoint: string, env: Env = process.env): string {
  const mock = env.VERCEL_ENV === 'production' ? undefined : env.PUSH_MOCK_BASE?.trim().replace(/\/+$/, '');
  if (!mock) return endpoint;
  try {
    const parsed = new URL(endpoint);
    if (parsed.hostname !== PUSH_MOCK_HOST) return endpoint;
    return `${mock}${parsed.pathname}${parsed.search}`;
  } catch {
    return endpoint;
  }
}
