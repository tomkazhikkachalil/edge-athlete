/**
 * Best-effort haptic tick for gesture feedback (long-press, etc.).
 *
 * There is no cross-platform web haptics API:
 * - Android Chrome implements `navigator.vibrate` — the official path.
 * - iOS Safari has NO vibration API at all. The one working technique
 *   (iOS 17.4+) is toggling an `<input type="checkbox" switch>`, which the
 *   OS accompanies with a haptic tick. It's undocumented behavior used
 *   best-effort: on any platform where it does nothing, it silently does
 *   nothing — the whole call is a progressive enhancement, never load-bearing.
 *
 * Must be called from (or shortly after) a user gesture; both paths are
 * ignored outside user activation.
 */
export function haptic(): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(10);
      return;
    }
    if (typeof document === 'undefined') return;
    const label = document.createElement('label');
    label.style.display = 'none';
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.setAttribute('switch', '');
    label.appendChild(input);
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {
    // Best-effort only — never let feedback break the gesture itself.
  }
}
