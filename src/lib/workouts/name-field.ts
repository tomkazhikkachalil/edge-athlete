// ── Exercise names: editing and the cut-off line (Oct 17 2026) ─────────────
// Pure, zero imports. Tom: renaming must keep the name and build words; a name
// too long for its line ends in "…" and a tap shows it whole.

/** A text field that can place its cursor (an <input>, or a test double). */
export interface CaretField {
  value: string;
  setSelectionRange(start: number, end: number): void;
}

/** Open an edit with the cursor after the current text — never selecting it,
 *  so the first key adds to the name instead of replacing it. */
export function placeCaretAtEnd(field: CaretField): void {
  const end = field.value.length;
  field.setSelectionRange(end, end);
}

/** A one-line name is cut off when its text is wider than its box (a pixel of
 *  rounding is not a cut). */
export function isTruncated(scrollWidth: number, clientWidth: number): boolean {
  return scrollWidth - clientWidth > 1;
}
