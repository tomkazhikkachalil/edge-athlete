/**
 * PR celebration: confetti burst + haptic tick. JS-driven animation is NOT
 * covered by the global reduced-motion CSS kill-switch, so this self-checks
 * the media query (and passes canvas-confetti's own flag, belt and braces).
 * The library is dynamically imported so it never touches the main bundle
 * until a PR actually happens; it appends its own fixed <canvas> to
 * document.body, above any transformed ancestor — immune to the Tailwind v4
 * stacking-context trap. Never load-bearing: every failure is swallowed.
 */

import { haptic } from '@/lib/haptics';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return true;
  }
}

// Brand violets + PB amber — the same color language the badges wear.
const CONFETTI_COLORS = ['#7c3aed', '#a78bfa', '#f59e0b', '#fbbf24'];

export async function celebratePR(): Promise<void> {
  haptic();
  if (prefersReducedMotion()) return;
  try {
    const confetti = (await import('canvas-confetti')).default;
    const base = {
      spread: 70,
      ticks: 220,
      gravity: 0.9,
      colors: CONFETTI_COLORS,
      disableForReducedMotion: true,
      // Above toasts (--z-toast: 80); confetti must never sit under chrome.
      zIndex: 90,
    };
    confetti({ ...base, particleCount: 80, angle: 70, origin: { x: 0.25, y: 0.65 } });
    confetti({ ...base, particleCount: 80, angle: 110, origin: { x: 0.75, y: 0.65 } });
  } catch {
    /* celebration is a garnish, never an error */
  }
}
