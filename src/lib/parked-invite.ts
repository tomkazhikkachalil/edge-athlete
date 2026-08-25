// Parked-signup invite persistence (dummy-proofing round). The parked
// screen is a just-registered minor's ONLY reachable surface, and the
// guardian invite link shown there used to live in component state — one
// refresh/back-tap/app-switch and it was gone with no self-serve way back.
// Versioned localStorage with the invite's own 7-day TTL; cleared when the
// minor EXPLICITLY leaves the screen (back to login) — navigating away by
// accident is not a decision. parse is pure for node tests; storage ops
// no-op on throw (SSR/private mode).

export interface ParkedInvite {
  message: string;
  inviteUrl: string | null;
}

const KEY = 'ea:parked-invite:v1';
export const PARKED_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // invite validity

export function parseParkedInvite(raw: string | null, now: number = Date.now()): ParkedInvite | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as {
      v?: unknown;
      savedAt?: unknown;
      message?: unknown;
      inviteUrl?: unknown;
    };
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > PARKED_INVITE_TTL_MS) return null;
    return {
      message: typeof parsed.message === 'string' ? parsed.message : '',
      inviteUrl: typeof parsed.inviteUrl === 'string' ? parsed.inviteUrl : null,
    };
  } catch {
    return null;
  }
}

export function loadParkedInvite(): ParkedInvite | null {
  try {
    const stored = parseParkedInvite(window.localStorage.getItem(KEY));
    if (!stored) window.localStorage.removeItem(KEY);
    return stored;
  } catch {
    return null;
  }
}

export function saveParkedInvite(invite: ParkedInvite): void {
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ v: 1, savedAt: Date.now(), ...invite })
    );
  } catch {
    /* ignore */
  }
}

export function clearParkedInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
