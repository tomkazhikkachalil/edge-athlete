/** YYYY-MM-DD (UTC) for DATE-column range filters — the 057 convention shared by every read-time overlay. */
export function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}
