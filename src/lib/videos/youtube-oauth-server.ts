// ── The connect flow's shared pieces (Videos program Phase 3) — SERVER ONLY ──
// The signed state names the OWNER and the SCOPE as its "provider" string
// (oauth-state-server.ts binds it to the account for ten minutes); the PKCE
// verifier rides an httpOnly cookie scoped to the two routes. Both routes
// read these, so the spelling has one owner.

import type { NextRequest } from 'next/server';
import { signOAuthState, verifyOAuthState } from '@/lib/activities/oauth-state-server';
import { ownerRef, parseOwnerRef, isScopeKey, type ConnectionOwner, type ScopeKey } from './youtube-connection';

export const PKCE_COOKIE = 'ea-yt-pkce';
/** The flow round (Nov 10 2026): the screen that started the connect, when it asked to be returned to — beside the verifier, same path, same ten minutes; read back through `connectReturnPath` again. */
export const RETURN_COOKIE = 'ea-yt-return';
export const PKCE_COOKIE_PATH = '/api/videos/youtube';
const PKCE_TTL_S = 600;

export function pkceCookieOptions(request: NextRequest) {
  return { httpOnly: true, sameSite: 'lax' as const, secure: request.nextUrl.protocol === 'https:', path: PKCE_COOKIE_PATH, maxAge: PKCE_TTL_S };
}

const providerFor = (owner: ConnectionOwner, scope: ScopeKey) => `youtube:${ownerRef(owner)}:${scope}`;

export function signConnectState(userId: string, owner: ConnectionOwner, scope: ScopeKey): string {
  return signOAuthState({ userId, provider: providerFor(owner, scope) });
}

/** The owner and scope a state was made for — only when the signature holds for THIS account. */
export function readConnectState(state: string | null | undefined, userId: string): { owner: ConnectionOwner; scope: ScopeKey } | null {
  if (typeof state !== 'string') return null;
  let provider: unknown;
  try {
    provider = (JSON.parse(Buffer.from(state.split('.')[0] ?? '', 'base64url').toString('utf8')) as { p?: unknown }).p;
  } catch {
    return null;
  }
  if (typeof provider !== 'string' || !provider.startsWith('youtube:')) return null;
  const parts = provider.split(':'); // youtube : kind : id : scope
  if (parts.length !== 4) return null;
  const owner = parseOwnerRef(`${parts[1]}:${parts[2]}`);
  const scope = parts[3];
  if (!owner || !isScopeKey(scope)) return null;
  if (!verifyOAuthState(state, { userId, provider })) return null;
  return { owner, scope };
}

export function callbackUri(request: NextRequest): string {
  return `${new URL(request.url).origin}/api/videos/youtube/callback`;
}
