/**
 * AI runner contract (Phase 3 scaffold). The editor talks to models ONLY
 * through this interface — which model, where it runs, and what it costs
 * are deployment decisions, not code decisions.
 *
 * COST GATE (the mandate's one hard stop): this repo ships NO models, NO
 * weights, and NO hosted inference. A runner exists only when
 * NEXT_PUBLIC_AI_RUNNER_URL points at an endpoint someone deliberately
 * provisioned (e.g. a self-hosted server on the developer's own machine —
 * see docs/AI_RUNNER.md). Unset = every AI affordance is invisible.
 */

export interface SegmentSubjectResult {
  /** Binary mask, RLE-encoded in the recipe's data-mask format
   *  (mask-rle.ts: runs of 0s/1s starting with zeros, comma-joined). */
  width: number;
  height: number;
  rle: string;
}

export interface AiRunner {
  /** Human-readable target (shown nowhere yet; useful for debugging). */
  readonly endpoint: string;
  /**
   * Segment the primary subject of the image. `image` is the FRAMED
   * image (recipe geometry applied) as an encoded blob — the mask lands
   * in the same coordinate space as every other mask.
   */
  segmentSubject(image: Blob): Promise<SegmentSubjectResult | null>;
  // Future capabilities, same shape (see docs/AI_RUNNER.md §Protocol):
  // inpaint(image: Blob, mask: SegmentSubjectResult): Promise<Blob | null>
  // upscale(image: Blob, factor: 2 | 4): Promise<Blob | null>
}
