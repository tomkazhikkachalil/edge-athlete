// Parked org-claim token (phase 1 round 2) — the parked-invite recipe: a
// signed-out visitor to /org-claim/[token] parks the token here before the
// sign-in/sign-up detour, and ResumeOrgClaimBanner (AppHeader) offers the
// way back once they're authed. TTL matches the invite's 30 days. Pure
// parse for node tests; storage ops no-op on throw.

export interface ParkedOrgClaim {
  token: string;
  orgName: string;
}

const KEY = 'ea:org-claim-parked:v1';
export const ORG_CLAIM_PARKED_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function parseParkedOrgClaim(raw: string | null, now: number = Date.now()): ParkedOrgClaim | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { v?: unknown; savedAt?: unknown } & Partial<ParkedOrgClaim>;
    if (parsed?.v !== 1 || typeof parsed.savedAt !== 'number') return null;
    if (now - parsed.savedAt > ORG_CLAIM_PARKED_TTL_MS) return null;
    if (typeof parsed.token !== 'string' || parsed.token.length < 20) return null;
    return { token: parsed.token, orgName: typeof parsed.orgName === 'string' ? parsed.orgName : 'your organization' };
  } catch {
    return null;
  }
}

export function loadParkedOrgClaim(): ParkedOrgClaim | null {
  try {
    return parseParkedOrgClaim(window.localStorage.getItem(KEY));
  } catch {
    return null;
  }
}

export function saveParkedOrgClaim(parked: ParkedOrgClaim): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ v: 1, savedAt: Date.now(), ...parked }));
  } catch {
    /* ignore */
  }
}

export function clearParkedOrgClaim(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
