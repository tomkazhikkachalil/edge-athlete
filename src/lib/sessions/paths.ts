// ── The screens that ARE a session (resume pill program, Oct 12 2026) ────────
// One list, two readers: the reopen prompt never asks over the thing itself
// (drafts/reopen.ts reopenSkipsPath) and the resume pill never floats over
// it — the live scorer, the recorder, the workout editor and the Drafts area
// (which lists them). Pure, zero imports.

const SESSION_SCREEN_PREFIXES = ['/live/', '/activities/record', '/app/workout/', '/athlete/drafts'] as const;

/** True on a session's own screen (or its list); a missing path counts as one — nothing floats over nothing. */
export function isSessionScreen(pathname: string | null | undefined): boolean {
  if (!pathname) return true;
  return SESSION_SCREEN_PREFIXES.some(p => (p.endsWith('/') ? pathname.startsWith(p) : pathname === p || pathname.startsWith(`${p}/`)));
}
