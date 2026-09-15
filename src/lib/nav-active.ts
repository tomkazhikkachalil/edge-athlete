/**
 * The ONE "is this place active" rule (Events program, phase 2b, B4). The
 * header's sliding pill and the phone tab bar both light from here — a
 * page must never read as Sports in one and Feed in the other. Extracted
 * verbatim from AppHeader.isActivePath; returns a strict boolean. Pure.
 */
import { isSportsPath } from './sports-nav';

export function activeNavPath(pathname: string | null | undefined, path: string): boolean {
  if (!pathname) return false;
  if (path === '/feed') return pathname === '/feed';
  if (path === '/athlete') return pathname === '/athlete' || pathname.startsWith('/athlete/');
  if (path === '/messages') return pathname === '/messages' || pathname.startsWith('/messages/');
  if (path === '/notifications') return pathname === '/notifications';
  // A round page IS the Live section; exact-match left the tab dark while
  // you were literally watching a live round.
  if (path === '/live') return pathname === '/live' || pathname.startsWith('/live/');
  // The Sports section is /sports/* AND an event's own page (/events/*).
  if (path === '/sports') return isSportsPath(pathname);
  return pathname === path;
}
