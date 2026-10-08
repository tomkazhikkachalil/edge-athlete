// ── Follow my position: the one rule (Golf course flow fixes M1, Oct 2026) ──
// Tom: "the map centres on the GPS position only when Follow is on; default
// on when the user is physically at the course, off otherwise." Until this
// PR the live map followed every fix SILENTLY whenever location permission
// was already granted (an Aug 23 behaviour that the composer's Near me
// button suddenly handed to far more people) — a round peeked at from the
// couch opened on the sofa, not the course. Pure, zero React: the map
// component decides ONCE on the first fix after tracking starts and the
// toggle owns it from there.

import { haversineKm } from '@/lib/golf/geocode';

/** How close a fix has to be to the course pin — or to any hole's tee or
 *  green — to count as "at the course". A pin at the clubhouse and a player
 *  on the far nine is the normal case, hence the holes. */
export const AT_COURSE_KM = 1.5;

export interface FollowContext {
  /** The course pin, [lat,lng]. */
  pin: [number, number];
  /** The hole lines when the cache holds them (tee first, green last). */
  holes?: Array<{ line: [number, number][] }> | null;
}

/** True when the fix is within AT_COURSE_KM of the pin or of any hole's
 *  tee or green. */
export function atCourse(fix: [number, number], ctx: FollowContext, km: number = AT_COURSE_KM): boolean {
  const near = (p: [number, number]) => haversineKm({ lat: fix[0], lng: fix[1] }, { lat: p[0], lng: p[1] }) <= km;
  if (near(ctx.pin)) return true;
  for (const h of ctx.holes ?? []) {
    if (h.line.length === 0) continue;
    if (near(h.line[0]) || near(h.line[h.line.length - 1])) return true;
  }
  return false;
}

/** The one-time default for the toggle: on at the course, off elsewhere. */
export function followDefault(fix: [number, number], ctx: FollowContext): boolean {
  return atCourse(fix, ctx);
}

/** Pan to a fix only when Follow is ON and nothing has paused it (a drag,
 *  or a hole being fitted — the fit always wins; Re-center resumes). */
export function shouldPan(follow: boolean | null, paused: boolean): boolean {
  return follow === true && !paused;
}
