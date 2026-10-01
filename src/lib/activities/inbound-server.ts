// ── What arrives at the upload link (PR 3) — SERVER ONLY ────────────────────
// The personal upload link takes whatever the athlete's phone can send:
//
//   • the bridge app's workout JSON (adapters/health-export.ts) — the Apple
//     Watch path;
//   • a raw .FIT / .GPX / .TCX body — a Shortcut, a script, or any app that
//     can POST the file a watch exports.
//
// The body is SNIFFED, never trusted to its Content-Type (bridge apps and
// Shortcuts send what they like): a FIT header, a JSON opening, an XML root.
// Server-only because a FIT is decoded here (the FIT SDK's licence — see
// parse-fit-server.ts); everything else in this file is pure over bytes.

import { parseHealthExport, looksLikeHealthExport, type AdaptedActivity } from './adapters/health-export';
import { parseFit } from './parse-fit-server';
import { parseGpx } from './parse-gpx';
import { parseTcx } from './parse-tcx';
import { ActivityParseError } from './xml-scan';

/** Vercel's request cap is 4.5 MB; a long ride's export stays under this. */
export const MAX_INBOUND_BYTES = 4 * 1024 * 1024;

export const INBOUND_UNREADABLE =
  'This link takes a workout export from Health Auto Export, or a .fit, .gpx or .tcx file.';

export type InboundRead =
  | { ok: true; items: AdaptedActivity[]; skipped: number }
  | { ok: false; status: 415 | 422; error: string };

function isFit(bytes: Uint8Array): boolean {
  // ".FIT" at offset 8 of the 12- or 14-byte header.
  return bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54;
}

export function readInbound(bytes: Uint8Array): InboundRead {
  if (bytes.length === 0) return { ok: false, status: 415, error: INBOUND_UNREADABLE };
  try {
    if (isFit(bytes)) return { ok: true, items: [{ activity: parseFit(bytes), externalId: null }], skipped: 0 };

    const text = new TextDecoder('utf-8').decode(bytes).replace(/^﻿/, '').trimStart();
    if (text.startsWith('{')) {
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        return { ok: false, status: 422, error: 'This export is not valid JSON.' };
      }
      if (!looksLikeHealthExport(json)) return { ok: false, status: 415, error: INBOUND_UNREADABLE };
      const parsed = parseHealthExport(json);
      return { ok: true, items: parsed.activities, skipped: parsed.skipped };
    }
    if (text.startsWith('<')) {
      const head = text.slice(0, 2000);
      if (/<gpx[\s>]/i.test(head)) return { ok: true, items: [{ activity: parseGpx(text), externalId: null }], skipped: 0 };
      if (/<TrainingCenterDatabase[\s>]/i.test(head)) return { ok: true, items: [{ activity: parseTcx(text), externalId: null }], skipped: 0 };
    }
    return { ok: false, status: 415, error: INBOUND_UNREADABLE };
  } catch (e) {
    // ActivityParseError messages are written for the athlete (xml-scan.ts).
    if (e instanceof ActivityParseError) return { ok: false, status: 422, error: e.message };
    console.error('[activities/inbound] read failed:', e instanceof Error ? e.message : e);
    return { ok: false, status: 422, error: 'This file could not be read.' };
  }
}
