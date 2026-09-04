// Parked staff-invite token (org staff program, 178) — org-claim-parked's
// recipe on its own key: a signed-out visitor to /org-invite/[token] parks
// the token before the sign-in/sign-up detour, and ResumeOrgInviteBanner
// (AppHeader) offers the way back once they're authed. TTL matches the
// invite's 30 days. Pure parse for node tests; storage ops no-op on throw.

export interface ParkedOrgInvite {
  token: string;
  orgName: string;
}

const KEY = 'ea:org-invite-parked:v1';
export const ORG_INVITE_PARKED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseParkedOrgInvite(raw: string | null, now: number = Date.now()): ParkedOrgInvite | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown } & Partial<ParkedOrgInvite>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > ORG_INVITE_PARKED_TTL_MS) return null;
    if (typeof parsed.token !== 'string' || parsed.token.length < 20) return null;
    return { token: parsed.token, orgName: typeof parsed.orgName === 'string' ? parsed.orgName : 'the organization' };
  } catch {
    return null;
  }
}

export function loadParkedOrgInvite(): ParkedOrgInvite | null {
  try {
    return parseParkedOrgInvite(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveParkedOrgInvite(parked: ParkedOrgInvite): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...parked }));
  } catch {
    /* ignore */
  }
}

export function clearParkedOrgInvite(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
