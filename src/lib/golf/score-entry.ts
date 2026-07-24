// ── Score-entry session logic ─────────────────────────────────────────────────
// Pure helpers behind ScoreEntryModal, extracted so the resume/durability rules
// are unit-testable (the modal itself has no test harness — no jsdom).

/**
 * The 1-based POSITION (index into the modal's holeData, not the hole number)
 * of the first hole without a score. Back-9 rounds pass startingHoleNumber=10,
 * so position 1 = hole 10. Gaps count: scored 1-3, skipped 4, scored 5 → 4.
 * Everything scored → the last position (an "Edit Scores" reopen lands on the
 * final hole rather than hole 1).
 */
export function firstUnscoredHole(
  existingScores: Array<{ hole_number: number }>,
  holesPlayed: number,
  startingHoleNumber = 1
): number {
  if (holesPlayed < 1) return 1;
  const scored = new Set(existingScores.map(s => s.hole_number));
  for (let pos = 1; pos <= holesPlayed; pos++) {
    if (!scored.has(startingHoleNumber + pos - 1)) return pos;
  }
  return holesPlayed;
}
