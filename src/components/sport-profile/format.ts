/** "Mar 7, 2026" from YYYY-MM-DD — string-sliced, never through a timezone. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDateShort(day: string): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d || m < 1 || m > 12) return day;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}
