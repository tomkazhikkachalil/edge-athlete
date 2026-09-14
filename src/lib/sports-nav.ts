/**
 * The Sports section (Events program, phase-1-minimal navigation): Sports
 * replaces Explore in the header; under it, three places. Pure.
 */
export const SPORTS_SECTIONS = [
  { key: 'explore', path: '/sports/explore', label: 'Explore', icon: 'fa-compass' },
  { key: 'events', path: '/sports/events', label: 'Events', icon: 'fa-flag-checkered' },
  { key: 'leaderboards', path: '/sports/leaderboards', label: 'Leaderboards', icon: 'fa-trophy' },
] as const;
export type SportsSectionKey = (typeof SPORTS_SECTIONS)[number]['key'];

/** Which section a pathname sits in; an event's own page counts as Events. */
export function activeSportsSection(pathname: string | null | undefined): SportsSectionKey | null {
  if (!pathname) return null;
  if (pathname === '/sports' || pathname === '/sports/') return 'explore';
  for (const s of SPORTS_SECTIONS) if (pathname === s.path || pathname.startsWith(`${s.path}/`)) return s.key;
  if (pathname === '/events' || pathname.startsWith('/events/')) return 'events';
  return null;
}

/** The header's Sports link lights for the whole section, events pages included. */
export function isSportsPath(pathname: string | null | undefined): boolean {
  return activeSportsSection(pathname) !== null;
}

export const EVENTS_FILTERS = ['upcoming', 'live', 'past', 'mine'] as const;
export type EventsFilter = (typeof EVENTS_FILTERS)[number];
export function parseEventsFilter(value: string | null | undefined): EventsFilter {
  return (EVENTS_FILTERS as readonly string[]).includes(value ?? '') ? (value as EventsFilter) : 'upcoming';
}
export const EVENTS_FILTER_LABEL: Readonly<Record<EventsFilter, string>> = { upcoming: 'Upcoming', live: 'Live', past: 'Past', mine: 'All mine' };
