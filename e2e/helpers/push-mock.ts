import { createECDH, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
// http_ece is web-push's own payload codec — the receiving half here.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require('http_ece') as {
  decrypt: (buffer: Buffer, params: { version: string; privateKey: unknown; authSecret: string }) => Buffer;
};

// A stand-in for a phone's push service (e2e/push.spec.ts). The LOCAL test
// server delivers any subscription on `push.e2e.invalid` here
// (src/lib/push/config-server.ts deliveryUrl, PUSH_MOCK_BASE — ignored by a
// production deployment). Each device made with `newDevice()` holds a real
// P-256 key pair, so a delivery is DECRYPTED here: the test reads exactly the
// payload a phone's service worker would.

export const PUSH_MOCK_PORT = 4872;
export const PUSH_MOCK_BASE = `http://127.0.0.1:${PUSH_MOCK_PORT}`;

/** A throwaway key pair for the LOCAL test server only (never a deployment's). */
export const PUSH_E2E_VAPID = {
  publicKey: 'BOYdFSS2g7umny-o552Z5dPq8wyGTLxFeaYk7Hltx5Xc8tXFYbiTzsaTyrGsWRqWUeIZL1heJBmVH9UHUHTn41Y',
  privateKey: 'tQYut9wGpUKpahIESQfLcJNbPACJf645fSDJXrHGJG4',
};

/** What the local test server is started with. */
export const PUSH_E2E_ENV: Record<string, string> = {
  VAPID_PUBLIC_KEY: PUSH_E2E_VAPID.publicKey,
  VAPID_PRIVATE_KEY: PUSH_E2E_VAPID.privateKey,
  VAPID_SUBJECT: 'mailto:e2e@example.com',
  PUSH_MOCK_BASE,
};

export interface MockDevice {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface Delivery {
  deviceId: string;
  ttl: string | null;
  payload: Record<string, unknown> | null;
}

export interface PushMock {
  newDevice(): MockDevice;
  /** What the push service answers for this device from now on (201 by default). */
  answer(deviceId: string, status: number): void;
  deliveries: Delivery[];
  close(): Promise<void>;
}

export async function startPushMock(): Promise<PushMock> {
  const keys = new Map<string, { ecdh: ReturnType<typeof createECDH>; auth: string }>();
  const statuses = new Map<string, number>();
  const deliveries: Delivery[] = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', c => chunks.push(c as Buffer));
    req.on('end', () => {
      const match = /^\/s\/([\w-]+)$/.exec(req.url ?? '');
      const deviceId = match?.[1] ?? '';
      const device = keys.get(deviceId);
      let payload: Record<string, unknown> | null = null;
      if (device && chunks.length > 0) {
        try {
          const clear = ece.decrypt(Buffer.concat(chunks), {
            version: 'aes128gcm',
            privateKey: device.ecdh,
            authSecret: device.auth,
          });
          payload = JSON.parse(clear.toString('utf8'));
        } catch {
          payload = null;
        }
      }
      deliveries.push({ deviceId, ttl: (req.headers.ttl as string | undefined) ?? null, payload });
      res.writeHead(statuses.get(deviceId) ?? 201);
      res.end();
    });
  });
  await new Promise<void>(resolve => server.listen(PUSH_MOCK_PORT, '127.0.0.1', resolve));

  return {
    newDevice() {
      const id = randomBytes(8).toString('hex');
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      const auth = randomBytes(16).toString('base64url');
      keys.set(id, { ecdh, auth });
      return {
        id,
        endpoint: `https://push.e2e.invalid/s/${id}`,
        p256dh: ecdh.getPublicKey().toString('base64url'),
        auth,
      };
    },
    answer(deviceId, status) {
      statuses.set(deviceId, status);
    },
    deliveries,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
  };
}
