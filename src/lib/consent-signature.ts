// Signature-card rendering (Wave 3, mig 130). The typed/drawn consent
// methods produce a PNG "signature card" that travels the existing
// consent-evidence path, so the admin reviewer sees every method the same
// way: a picture of a signature attached to the statement version it signs.
// Layout text is pure (node-tested); pixel work happens client-side on a
// plain 2D canvas (the browser has one; the server does not).

import { CONSENT_POLICY_VERSION } from './consent';

export const SIGNATURE_CARD_WIDTH = 800;
export const SIGNATURE_CARD_HEIGHT = 400;

export interface SignatureCardMeta {
  guardianEmail: string;
  /** ISO date (yyyy-mm-dd) the card is signed. */
  dateIso: string;
}

/** A normalized freehand stroke (0..1 coords, top-left origin). */
export type SignatureStroke = Array<{ x: number; y: number }>;

/** The card's text lines — header above the signature, footer below. */
export function signatureCardLines(meta: SignatureCardMeta): { header: string[]; footer: string } {
  return {
    header: [
      `Edge Athlete Parental Consent — ${CONSENT_POLICY_VERSION}`,
      'Signature card — the full statement shown at signing is recorded with this consent.',
    ],
    footer: `Signed by ${meta.guardianEmail} · ${meta.dateIso}`,
  };
}

export interface RenderSignatureCardOptions {
  meta: SignatureCardMeta;
  /** Exactly one of the two. */
  typedName?: string;
  strokes?: SignatureStroke[];
}

/**
 * Draw the card onto a 2D context sized SIGNATURE_CARD_WIDTH×HEIGHT.
 * Client-only (needs canvas); the caller owns toBlob + canvas teardown.
 */
export function renderSignatureCard(
  ctx: CanvasRenderingContext2D,
  { meta, typedName, strokes }: RenderSignatureCardOptions
): void {
  const w = SIGNATURE_CARD_WIDTH;
  const h = SIGNATURE_CARD_HEIGHT;
  const { header, footer } = signatureCardLines(meta);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = '#111111';
  ctx.font = 'bold 20px system-ui, sans-serif';
  ctx.fillText(header[0], 32, 44);
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillStyle = '#555555';
  ctx.fillText(header[1], 32, 70);

  // Signature area
  const areaTop = 100;
  const areaBottom = h - 70;
  ctx.strokeStyle = '#dddddd';
  ctx.strokeRect(32, areaTop, w - 64, areaBottom - areaTop);

  if (typedName) {
    ctx.fillStyle = '#111111';
    ctx.font = 'italic 48px Georgia, "Times New Roman", serif';
    ctx.textAlign = 'center';
    ctx.fillText(typedName, w / 2, (areaTop + areaBottom) / 2 + 16, w - 96);
    ctx.textAlign = 'left';
  } else if (strokes && strokes.length > 0) {
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const areaW = w - 64;
    const areaH = areaBottom - areaTop;
    for (const stroke of strokes) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      stroke.forEach((p, i) => {
        const px = 32 + p.x * areaW;
        const py = areaTop + p.y * areaH;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      // A tap is a dot, not an invisible zero-length path.
      if (stroke.length === 1) {
        ctx.lineTo(32 + stroke[0].x * areaW + 0.5, areaTop + stroke[0].y * areaH);
      }
      ctx.stroke();
    }
  }

  ctx.fillStyle = '#555555';
  ctx.font = '14px system-ui, sans-serif';
  ctx.fillText(footer, 32, h - 36);
}
