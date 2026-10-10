/**
 * The compact "when" on a card's header: Just now · 5m · 3h · 2d · Oct 9 ·
 * Oct 9, 2025. Pure; zero imports.
 *
 * date-fns' "less than a minute ago" / "about 3 hours ago" ran past the post
 * header's width on a phone and truncated the sport label beside it (the Oct
 * 9 2026 appearance audit). The full date stays on the element's title.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortAgo(when: Date | string | number, now: Date = new Date()): string {
  const d = when instanceof Date ? when : new Date(when);
  const ms = now.getTime() - d.getTime();
  if (!Number.isFinite(ms)) return '';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return 'Just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d`;
  const label = `${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === now.getFullYear() ? label : `${label}, ${d.getFullYear()}`;
}
